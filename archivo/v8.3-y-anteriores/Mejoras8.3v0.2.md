# MEJORAS v8.3 — ANÁLISIS UNIFICADO DE HUECOS, INTERCONEXIONES Y OPORTUNIDADES v0.2
## Sistema Operativo de Aseo | Lulu Island Flagship

**Documento:** Mejoras8.3v0.2
**Fecha:** 4 de Agosto, 2026
**Jurisdicción:** British Columbia, Canadá
**Fuentes integradas:** v8.3 Plan de Construcción (715 líneas, E0→E11) · Mejoras v0.1 (662 líneas, 13 adoptadas + 8 rechazadas) · Anexo de Vulnerabilidades v0.2 · Auditoría crítica v0.2 · Evolución arquitectónica v0.2 (707 líneas, B.14→B.33) · Codebase real (175 `lib/`, 72 componentes, 50+ pantallas admin)
**Principio rector:** La arquitectura debe servir al negocio, no al revés. Cada línea de código que no resuelve un problema real de limpieza es una línea que tendremos que mantener mañana.

---

# PARTE A: RESUMEN EJECUTIVO — LO QUE ESTE DOCUMENTO RESUELVE

El v8.3 está bien diseñado hacia adentro (operaciones, despacho, financiero). Pero tiene tres debilidades estructurales que este documento ataca:

1. **Los módulos no se hablan entre sí.** Hay 175 archivos de lógica pero cero contratos explícitos de interconexión. Eso genera islas: despacho no sabe de nómina, marketing no sabe de inventario, QC no alimenta al SOP.
2. **El cliente que paga $70+/hora no ve valor.** Recibe una notificación de «completado» y punto. No hay tracking en vivo, no hay perfil del equipo, no hay reporte de salud del hogar, no hay garantía visible. El que financia el sistema es el peor atendido.
3. **El admin tiene 50 pantallas pero ningún tablero de mando.** Mucha información, cero jerarquía. Necesita un Command Center que le diga el estado del negocio en 10 segundos y un simulador para jugar con escenarios antes de ejecutarlos.

Este documento identifica **42 hallazgos** (16 críticos, 16 mayores, 10 menores) y para cada uno propone solución concreta, etapa de integración y archivos del codebase que tocar.

---

# PARTE B: METODOLOGÍA DE CLASIFICACIÓN

| Clasificación | Significado |
|---------------|-------------|
| 🔴 **HUECO CRÍTICO** | Rompe un flujo de negocio, genera riesgo legal/financiero, o impide operar |
| 🟠 **HUECO MAYOR** | Degrada la experiencia, la eficiencia o la retención de clientes/empleados |
| 🟡 **HUECO MENOR** | Suma valor diferenciador pero no bloquea la operación |
| 🔵 **INTERCONEXIÓN** | Dos o más módulos que deberían hablar y no lo hacen |

---

# PARTE C: HUECOS CRÍTICOS — LO QUE ROMPE EL NEGOCIO HOY

## C.1 🔴 Interconexión Despacho ↔ Nómina: Sin puente de horas reales

El despacho (E3) asigna equipos con `N_min`, `N_max`, `T_bloqueo_max`. La nómina (E9) calcula Day Rates. Pero no hay un flujo que diga «este empleado trabajó 5.2h en esta orden → eso va a payroll».

**Solución:** `cierre_jornada_empleado` debe emitir `event.empleado.horas_registradas` con `orden_id`, `horas_reales`, `zonas_completadas`. Payroll se suscribe. `hhe-adjustment.ts` (ya existe en codebase) debe ser el puente.
**Etapa:** E3+E9 | **Archivos:** `lib/hhe-adjustment.ts`, `lib/payroll.ts`

## C.2 🔴 Interconexión Inventario ↔ Despacho: Sin verificación de insumos antes de asignar

El v8.3 menciona `equipment_reservations` y `supplier_catalog` como tablas huérfanas. Mejoras v0.1 lo identificó como bloqueante para E3. Si un equipo llega a campo sin desengrasante, el SOP falla, el tiempo se extiende, el margen muere.

**Solución:** Antes de asignar equipo a orden, el sistema calcula consumo estimado desde SOP (`Σ(tarea.cantidad_producto × zonas_del_servicio)`), verifica contra `inventario.stock_actual - inventario.reservado`, y si `stock < estimado + 20% buffer`, ofrece tres opciones: (A) generar PO urgente y retrasar 2h, (B) asignar equipo alternativo con stock, (C) alertar admin con costo/beneficio (fallback 10 min).
**Etapa:** E3 | **Archivos:** `lib/inventory-reorder.ts`, `lib/dispatch-approval.ts`

## C.3 🔴 Interconexión Marketing ↔ Inventario: Sin candado estacional

E10 propone campañas estacionales. E3/E7 manejan inventario. No hay candado entre ambas. Lanzar una campaña «Spring Refresh» sin stock asegurado de desengrasantes o filtros HEPA colapsará la operación.

**Solución:** Bloqueo transaccional de campañas. El módulo de Marketing no puede pasar a `ACTIVO` sin un query previo a Inventario proyectando consumo a 14 días. Si hay déficit, la campaña no sale.
**Etapa:** E10 | **Archivos:** `lib/seasonal-campaigns/` (existe ruta), `lib/inventory-reorder.ts`

## C.4 🔴 Interconexión Despacho ↔ Clima: Sin override automático por alerta meteorológica

`weather-provider.ts` y `weather-exception.ts` existen. Pero si Environment Canada emite alerta de nieve para Richmond mañana, el autopilot igual publica asignaciones. Equipo enviado en tormenta = accidente laboral = WorkSafeBC.

**Solución:** Regla en `dispatch-approval.ts`: si `weather_alert.severity >= 'warning'`, el autopilot no publica sin override humano. Además, inyectar buffer dinámico: si API reporta lluvia, sumar +15 min al `T_bloqueo` para mitigar arrastre de suciedad externa (lo absorbe el margen preventivo, no se cobra al cliente).
**Etapa:** E3 | **Archivos:** `lib/weather-provider.ts`, `lib/dispatch-approval.ts`

## C.5 🔴 QC ↔ Reentrenamiento: Sin loop de mejora automática

E5 define scores y niveles (Élite/Estándar/Observación/Suspendido). E8 habla de reentrenamiento. Pero no hay trigger automático: «Equipo Jade bajó a Observación por 3 semanas → generar plan correctivo». Y peor aún: cuando una zona específica (ej. Baños) falla >15% en un mes por *distintos* equipos, el problema no es el personal sino la técnica del SOP.

**Solución:** Evento `event.qc.nivel_cambio` dispara plan correctivo automático. Evento `event.sop.anomalia_detectada` se dispara cuando una zona falla consistentemente entre equipos distintos — el módulo SOP lo intercepta y levanta bandera al admin para ajustar técnica o tiempo HHE.
**Etapa:** E5+E8 | **Archivos:** `lib/scoring.ts`, `lib/career-path.ts`, `lib/hhe-adjustment.ts`

## C.6 🔴 PWA ↔ Servidor: Sin heartbeat de salud del empleado en campo

B.4 define sync protocol y vector clocks, pero el servidor no sabe si la PWA de un empleado está viva hasta que intenta sincronizar. Si un empleado sufre un accidente en una propiedad vacía, el sistema no se entera.

**Solución:** Heartbeat cada 5 minutos desde PWA: `POST {equipo_id, lat, lng, bateria_pct}`. Si falta >15 min → alerta admin: «Equipo Jade sin señal. Última ubicación: 49.1666, -123.1336. ¿Llamar? ¿Enviar ayuda?»
**Etapa:** E4 | **Archivos:** `lib/offline-sync-client.ts` (extender)

## C.7 🔴 Protocolo de Emergencia Personal: Sin flujo post-Safety Abort

`SafetyAbortButton.tsx` existe. Pero al presionarlo no hay flujo: ¿ambulancia? ¿policía? ¿salir de la propiedad? ¿quién llama? El GPS debe enviarse en tiempo real, no en el próximo sync. Si el admin no responde en 2 minutos, el sistema debe escalar al contacto de emergencia del empleado.

**Solución:** Flujo post-abort: (1) PWA muestra «🚑 Ambulancia / 👮 Policía / 🏠 Salir / 📞 Llámenme», (2) GPS se envía en tiempo real por canal prioritario, (3) admin recibe notificación push+SMS+email simultáneos, (4) timer 2 min para respuesta admin, (5) si no responde, escala a contacto de emergencia registrado en `empleado`. Esto es deber legal bajo WorkSafeBC BC OHS 4.22 (trabajo en aislamiento).
**Etapa:** E4 | **Archivos:** `components/empleado/SafetyAbortButton.tsx`, `lib/safety-abort.ts`

## C.8 🔴 Shadow Ledger ↔ QBO: Sin alertas de divergencia contable

`shadow-ledger.ts` y `qbo-adapter.ts` existen pero no hay job que compare ambos. Si divergen, el negocio opera con números falsos.

**Solución:** Job nocturno compara `shadow_ledger.saldo` vs `qbo.account_balance`. Divergencia >1% → alerta roja: «Conciliación manual requerida».
**Etapa:** E9 | **Archivos:** `lib/shadow-ledger.ts`, `lib/qbo-sync.ts`

## C.9 🔴 Tasa de Abuso de Garantía: Sin anti-gaming del lado del cliente

El sistema asume buena fe estadística. Un cliente inteligente aprende a buscar el 1% de fallo en fotos para reclamar re-servicios o descuentos continuos sin cruzar la línea de «fraude evidente». Esto erosiona margen silenciosamente.

**Solución:** Score de Fricción del Cliente. Si `tickets_abiertos / servicios_completados > 25%` (ej. 1 reclamo cada 4 servicios): (1) bloquear reservas esporádicas, (2) exigir Auditor de Campo obligatorio, (3) modal al admin: «Cliente de alto mantenimiento: ¿ajustar tarifa +15% o terminar relación?»
**Etapa:** E5 | **Archivos:** `lib/anti-gaming.ts` (extender), `lib/client-scoring.ts`

## C.10 🔴 Pago Recurrente Fallido: Sin período de gracia operativa

El sistema captura pagos a las 7 PM. Si falla un cobro recurrente por tarjeta expirada o bloqueada, no hay protocolo de gracia. Reintentar 3 veces y cancelar el servicio rompe la relación con un cliente bueno que simplemente cambió de tarjeta.

**Solución:** El fallo final no cancela el próximo servicio. Dispara estado `GRACIA_RECURRENTE (15 días)`. El servicio se realiza, el saldo se acumula en Shadow Ledger, y el cliente encuentra un muro de pago obligatorio al intentar acceder a su portal o solicitar servicios adicionales. Después de 15 días sin pago, se pausan futuras reservas.
**Etapa:** E2 | **Archivos:** `lib/payment-capture-reconciliation.ts`, `lib/batch-capture-eligibility.ts`

## C.11 🔴 Sin Command Center Unificado para el Admin

El admin salta entre 50 pantallas. Necesita UNA pantalla que en 10 segundos le diga: cuántos servicios activos, cuántos equipos en campo, alertas abiertas, caja disponible, margen del mes, fondo de emergencia, QC del día, disputas abiertas, próximos vencimientos legales.

**Solución:** Dashboard compuesto que consume `DashboardMetricsPanel.tsx` + `dashboard-metrics.ts` + `unified-alerts.ts` + `cash-reserve.ts`. No es una pantalla nueva desde cero; es composición de widgets existentes con jerarquía visual.
**Etapa:** E7 | **Archivos:** `components/admin/AdminDashboardClient.tsx`, `lib/dashboard-metrics.ts`

## C.12 🔴 Sin Simulador de Escenarios para el Admin

El admin necesita preguntar: «¿Qué pasa si contrato 2 personas más?» «¿Qué pasa si subo 10% los precios?» «¿Qué pasa si el Líder A renuncia hoy?» No puede saberlo sin Excel externo.

**Solución:** Sandbox de simulación con datos reales del sistema: (a) staffing — cuántos servicios más puedo tomar, (b) pricing — impacto de +X% en conversión e ingreso neto, (c) crisis — «blast radius» si un líder renuncia (órdenes en riesgo, pérdida proyectada, plan de contingencia borrador). El sandbox de pricing (`/admin/pricing-rules/sandbox`) YA existe; extenderlo.
**Etapa:** E9 | **Archivos:** `components/admin/AdminPricingRulesSandboxClient.tsx`, `lib/dispatch-approval.ts`

## C.13 🔴 Sin Infraestructura de Retargeting para Cotizaciones Abandonadas

Un cliente llena 3 pasos del cotizador y se va. El sistema no lo persigue. Eso es dinero tirado — el CAC ya se gastó en atraerlo.

**Solución:** Secuencia multi-canal post-abandono: T+1h email («¿Dudas? Hablemos»), T+24h SMS («Su cotización de $285 sigue vigente»), T+72h email con testimonio de cliente de su misma zona, T+7d último intento (sin descuento — protege LTV de recurrentes). Si no convierte, tag «dormido» para campaña de reactivación.
**Etapa:** E10 | **Archivos:** `lib/attribution.ts`, `lib/acquisition-channel.ts`, `lib/communications.ts`

## C.14 🔴 Sin Panel de Salud del Sistema (System Health)

El admin no sabe que algo falla hasta que explota. Necesita semáforos en tiempo real.

**Solución:** Seis semáforos en grid 2×4 actualizados cada 60s: (1) Despacho — % capacidad usada, (2) Inventario — ítems bajo mínimo, (3) Empleados — bench disponible, (4) Legal — feeds actualizados, (5) Pagos — sync QBO, (6) PWA Sync — dispositivos con sync pendiente. Click en celda → drill-down al detalle.
**Etapa:** E0 (datos) + E9 (UI) | **Archivos:** `lib/observability.ts`, `lib/backup-jobs.ts`, `lib/unified-alerts.ts`

## C.15 🔴 Sin Seguimiento de Carga Biomecánica del Empleado

Un equipo asignado a tres limpiezas «Post-construcción» (alta carga física, polvo denso, EPP pesado) en 48 horas sufrirá fatiga severa aunque su «ánimo» (E8) sea positivo. Esto baja calidad y arriesga lesiones WorkSafeBC.

**Solución:** Cada servicio tiene un Índice de Carga Biomecánica (1-5). El motor de despacho aplica hard-block: un empleado no puede acumular índice superior a X en ventana de 72 horas, forzando alternancia con servicios «Regulares» o «Move-out» vacíos.
**Etapa:** E8 | **Archivos:** `lib/dispatch-team.ts`, `lib/wellbeing.ts`

## C.16 🔴 Sin Pipeline de Contenido SEO Automatizado

`blog-content.ts` y `gbp-checklist.ts` existen pero no hay pipeline que genere contenido basado en búsquedas locales reales.

**Solución:** Keyword research local automático (Google Trends API o DataForSEO) → calendario editorial sugerido por estacionalidad («Agosto: limpieza post-verano, alergias, mascotas») → templates con estructura SEO validada (H1, H2, meta, schema `LocalBusiness`) → publicación con un clic. Landing pages dinámicas por zona y tipo de servicio generadas con Next.js ISR, con contenido real del portafolio y precios locales.
**Etapa:** E10 | **Archivos:** `lib/blog-content.ts`, `lib/gbp-checklist.ts`, `lib/seo-content-pipeline.ts` (nuevo)

---

# PARTE D: INTERCONEXIONES MODULARES — LOS 10 PUENTES QUE FALTAN

El problema más grave no es lo que falta dentro de cada módulo — es que los módulos no se hablan. Aquí están los 10 contratos de interconexión que deben existir:

| # | Origen | Destino | Evento/Contrato | Qué resuelve |
|---|--------|---------|-----------------|--------------|
| D.1 🔴 | Despacho (E3) | Nómina (E9) | `event.empleado.horas_registradas` | Que no se pague mal |
| D.2 🔴 | Inventario (E3) | Despacho (E3) | `inventario.stock >= consumo_sop + 20%` | Que el equipo no llegue sin insumos |
| D.3 🔴 | Marketing (E10) | Inventario (E3) | `campaña.ACTIVO` requiere `proyección_14d >= demanda_estimada` | Que una campaña no colapse la operación |
| D.4 🔴 | Clima | Despacho (E3) | `weather_alert.severity >= 'warning'` → pausa autopilot | Que no se mande equipo en tormenta |
| D.5 🔴 | QC (E5) | SOP/Carrera (E8) | `event.qc.nivel_cambio` + `event.sop.anomalia_detectada` | Que el feedback de calidad mejore las técnicas |
| D.6 🔴 | PWA (E4) | Servidor | Heartbeat cada 5 min | Que un empleado solo no quede incomunicado |
| D.7 🔴 | Shadow Ledger (E2) | QBO | Job nocturno de reconciliación | Que no haya divergencia contable |
| D.8 🟠 | Pricing Engine (E1) | Competitor Tracking (E9) | `competitive-pricing.ts` ingiere `competitor-tracking.ts` | Que los precios sepan dónde está el mercado |
| D.9 🟠 | Legal Monitoring (E9) | Operaciones | `event.legal.cambio_regulatorio` → `chemical-lockout.ts` | Que una regulación nueva no tome al sistema por sorpresa |
| D.10 🟠 | Cliente (Account) | Admin (Comunicaciones) | Hilo completo de comunicación en `/admin/servicios/[orderId]` | Que el admin vea todo el contexto antes de responder |

**Implementación técnica de los eventos:** Todo evento usa el Event Map definido en Mejoras v0.1 (B.1): tabla `event_log` append-only en PostgreSQL, validación Zod, publicación dentro de la misma transacción de negocio, consumo vía polling cada 5s (suficiente para MVP), Dead Letter Queue tras 5 reintentos.

---

# PARTE E: VALOR PARA EL CLIENTE — LO QUE VE Y LO QUE NO VE

El cliente de $70+/hora no compra horas de limpieza; compra **tranquilidad, estatus y retorno de tiempo**. El sistema actual lo trata como un número de orden.

## E.1 Qué DEBE VER el cliente (y hoy no ve)

### E.1.1 🟢 Tracking en Vivo del Servicio («Centro de Transparencia»)

Entre la llegada del equipo y la notificación de «completado» hay 3-5 horas de silencio. El cliente no sabe qué pasa en su casa.

**Qué ve:** Portal en vivo con ETA del vehículo, zonas completadas («Cocina ✓, Baño en curso…»), productos usados. No es GPS del empleado — son hitos de zona.
**Archivos:** `lib/zone-assignment.ts`, ruta `/account/services/[orderId]`

### E.1.2 🟢 Perfil Público del Equipo (Pre-Servicio)

El cliente reserva sin saber *quién* viene. No pide nombre, pero sí quiere saber: ¿es un equipo verificado? ¿cuántos servicios han hecho? ¿hablan mi idioma?

**Qué ve:** «Equipo Jade — 4.9★, 120+ servicios, Certificado Nivel 2, habla mandarín.» Stats anónimas, sin nombres individuales.
**Archivos:** `lib/team-ranking.ts`, `lib/certifications.ts`

### E.1.3 🟢 Galería Post-Servicio con Valor («Home Health Report»)

Hoy el cliente recibe «Servicio completado». Debería recibir un reporte que transforme datos en insights:

- **Antes/Después visual:** 4-6 fotos comparativas de zonas limpiadas (anonimizadas por B.5.2).
- **Checklist completado:** Las tareas hechas, con timestamp por zona.
- **Nota de Cuidado del equipo:** «Cuidamos especialmente la zona de mascotas. Recomendamos ventilar 30 min.» (140 chars o voz transcrita, validado por NLP contra lista negra de frases — nunca diagnóstico médico, nunca crítica al cliente).
- **Reporte de Salud del Hogar:** «El equipo aplicó protocolo anti-sarro (pH ácido). Recomendamos encender el extractor del baño 15 min tras las duchas para prevenir acumulación.»
- **«Costo Acumulado Evitado»:** Para clientes recurrentes, un estimado de cuánto dinero en deterioro de materiales (madera, alfombras, mármol) están salvando gracias al mantenimiento correcto.
- **Métrica de calidad:** «Score QC de este servicio: 94/100 (Élite).»

**Archivos:** `lib/live-portfolio.ts`, `lib/closure-protocol.ts`, `components/cuenta/MisServiciosClient.tsx`

### E.1.4 🟢 Garantía Explícita Visible en Todo el Flujo

**Qué ve:**
- En checkout: «Garantía Lulu: Si algo no coincide con la foto de cierre, re-servamos gratis en 24h.»
- Post-servicio: «Su pago se procesa hoy 7 PM. ¿Algo no coincide? Repórtelo — revisamos contra la evidencia.»
- Botón visible de «Reportar issue» en `/account/services/[orderId]`.

**Archivos:** `lib/warranty-claim-validation.ts`, `lib/warranty-dispute-resolution.ts`

### E.1.5 🟢 Calculadora de Valor del Tiempo en el Cotizador

El cliente no debe ver «$285» — debe ver «Recupere 4.5 horas de su tiempo por $285».

**Qué ve:** Componente en el cotizador que traduce el precio a horas liberadas para el cliente, con desglose colapsable: Mano de obra ($168) + Productos ($35) + Seguro/Overhead ($42) + Margen ($40).
**Archivos:** `components/cotizador/PriceBreakdown.tsx` (ya existe; verificar/ampliar)

### E.1.6 🟢 Programa de Lealtad Visible

**Qué ve:**
- 3 servicios sin disputa → badge «Cliente Premium» + 5% descuento automático.
- 5 servicios → prioridad de slot garantizada (ya existe en E1.12, hacerlo visible).
- 10 servicios → nivel VIP con beneficios visibles.
- Panel de referidos: «Invitaste a 2 amigos → $50 de crédito.»
- Recompensa por densidad vecinal: «Estamos haciendo la ruta de su vecindario los martes. Si refiere a un vecino de su cuadra, ambos reciben nivel VIP inmediatamente.»

**Archivos:** `lib/referrals.ts`, `lib/client-scoring.ts`, `lib/client-segmentation.ts`

### E.1.7 🟢 Portal de Preferencias Reales

Qué puede configurar: química preferida (eco-friendly), info de mascotas (visible en briefing del equipo), acceso (código lockbox encriptado), zonas prioritarias, zonas «no tocar», frecuencia sugerida por metadata física.

**Archivos:** `lib/communication-preferences.ts` (extender a preferencias de servicio)

### E.1.8 🟢 Centro Documental del Cliente

Facturas, recibos, contratos, garantías — todo en un solo lugar. Historial completo descargable.
**Archivos:** `components/cuenta/MisServiciosClient.tsx`

## E.2 Qué NUNCA DEBE VER el cliente

- ❌ Su score interno, HHE, N (cantidad de personas asignadas).
- ❌ Score de riesgo de dirección (v8.3 B.2.3).
- ❌ Nombre individual de empleados (solo «Equipo X»).
- ❌ GPS cuando el vehículo está parado >10 min.
- ❌ Productos de colores incompatibles (el poka-yoke opera en PWA, no en portal).
- ❌ El tiempo real invertido en la limpieza. Si un equipo élite termina en 1h lo que a otro le toma 3h, mostrar «1h» castiga la eficiencia. Mostrar siempre «Esfuerzo Consolidado: su hogar recibió el equivalente a 3 horas-hombre de trabajo de precisión.»
- ❌ Excusas logísticas. «Llegamos tarde por tráfico» → «Ajustamos su hora para garantizar la llegada del Equipo Élite que ya conoce su hogar.»

---

# PARTE F: MÓDULO DEL EMPLEADO — LO QUE FALTA

El employee module (`/employee/`) tiene 13 sub-rutas y 10 componentes. Pero ignora realidades biológicas, financieras y de crecimiento profesional.

## F.1 🔴 Auto-Evaluación Post-Jornada

Al cerrar jornada en PWA, el líder responde 3 preguntas: (1) ¿Tuviste todos los insumos? (2) ¿Algo inesperado en la propiedad? (3) ¿Cómo te sentiste físicamente? (😊/😐/😫). Esto alimenta wellbeing, inventario y riesgo de propiedad.
**Archivos:** `lib/wellbeing.ts`, `lib/inventory-reorder.ts`, `lib/property-risk.ts`

## F.2 🔴 Reporte de Equipo Dañado/Fallado

Botón en PWA: foto del equipo → descripción → ¿se puede seguir? Si no, alerta inmediata al admin. Opciones: enviar reemplazo, autorizar skip de zona, reagendar.
**Archivos:** `lib/equipment-failure.ts` (nuevo), componente PWA

## F.3 🔴 Seguimiento de Carga Biomecánica

Índice 1-5 por servicio. Hard-block en despacho si acumulación > X en 72h. Fuerza alternancia de servicios pesados con livianos. Previene lesiones WorkSafeBC.
**Archivos:** `lib/dispatch-team.ts`, `lib/wellbeing.ts`

## F.4 🟠 Preferencias de Disponibilidad

Toggle en PWA por día (Mañana/Tarde/No disponible). El despacho lo usa como soft constraint. Si un empleado falta consistentemente en ciertos días → alerta al admin.
**Archivos:** `lib/dispatch-team.ts`, tabla `disponibilidad_empleado`

## F.5 🟠 Visibilidad y Previsibilidad Financiera (Reduce Ansiedad)

La PWA debe mostrar: «Ganancias hoy: $102.50 (Day Rate $90 + comisiones $12.50). Proyectado quincena: $1,230. Próximo depósito: viernes 15. Insignia Oro: 42/50 (te faltan 8, bono $50).» Si un turno se cancela con pago completo (Fallback), la UI celebra: «Turno cancelado por cliente. $146 asegurados en tu cuenta.»
**Archivos:** `lib/payroll.ts`, `lib/shadow-ledger.ts`, `lib/badges.ts`

## F.6 🟠 Métricas Personales Visibles (Sin Comparación)

El empleado ve SUS tendencias: «Tu eficiencia: 94% esta semana (vs 91% anterior).» «Tus clientes te calificaron 4.8/5 este mes.» «Llevas 3 semanas sin disputas.» Nunca: «Estás en el puesto 7 de 12.» Nunca score numérico individual — solo rangos («top 20%», «en promedio»).
**Archivos:** `lib/scoring.ts` (filtrar por `empleado_id`)

## F.7 🟠 Chat con el Admin (Canal Diferido)

Buzón en PWA: «Mensaje para coordinación» (no chat en tiempo real). Para temas no urgentes: cambio de día de pago, renovación de certificación, dudas administrativas. El admin lo ve en `/admin/comunicaciones`.
**Archivos:** `lib/communications.ts` (extender con `origen=empleado`)

## F.8 🟠 Marketplace de Turnos

El empleado puede ofrecer cubrir turnos de compañeros. El admin aprueba con un toque. Reemplaza el caos de WhatsApp actual.
**Archivos:** `lib/coworker-rotation.ts` (extender), componente PWA

## F.9 🟡 Onboarding Digital

Primer login en PWA → wizard de 5 pantallas: (1) Bienvenida y propósito, (2) Demo interactiva de la PWA, (3) Conoce a tus compañeros (fotos+nombre), (4) Tu primer día, (5) Canales de ayuda.
**Archivos:** `components/empleado/OnboardingWizard.tsx` (nuevo)

## F.10 🟡 Objetivos y Reconocimientos

Metas personales visibles (sin presión), insignias por logros, reconocimiento del admin visible en perfil. Ruta de carrera con siguiente paso claro.
**Archivos:** `lib/badges.ts`, `lib/career-path.ts`

---

# PARTE G: CONTROL TOTAL DEL ADMIN — DE 50 PANTALLAS A 1 TABLERO

## G.1 🔴 Command Center Unificado

Una pantalla con jerarquía visual:

```
┌─────────────────────────────────────────────────┐
│ HOY: 4 Ago 2026                                   │
│ 🏠 8 servicios activos   👥 3 equipos en campo    │
│ ⏰ 2 en progreso          🟢 1 completado          │
│ 🚨 1 alerta activa                               │
│                                                   │
│ 💰 Caja: $12,450    📊 Margen mes: 34.2%          │
│ 🏦 Fondo emergencia: 2.8 meses (🟢)               │
│                                                   │
│ ⭐ QC hoy: 92/100    📝 Disputas: 1 abierta        │
│ 🔔 Legal: próxima revisión en 12 días              │
│                                                   │
│ [Semáforos: Despacho🟢 Inv🟡 Emp🟢 Leg🟢 Pag🟢 PWA🟢] │
└─────────────────────────────────────────────────┘
```

## G.2 🔴 Simulador de Escenarios («Blast Radius»)

- Staffing: ¿Cuántos servicios más puedo tomar si contrato +1 equipo?
- Pricing: ¿Impacto de +10% en conversión e ingreso neto?
- Crisis: «¿Qué pasa si el Líder A renuncia hoy?» → simulación contra agenda 5 días → órdenes en riesgo → pérdida proyectada → borrador de plan de contingencia.

## G.3 🟠 Vista de Ciclo de Vida del Cliente (Customer Health Score)

Timeline visual del cliente: primera reserva → servicios → disputas → pausas → re-reservas. Score y tendencia (6 meses). LTV actual vs proyectado. Señales de churn: «Bajó de 2/mes a 1/mes.» «Última comunicación: hace 45 días. ¿Enviar check-in?»
**Archivos:** `lib/churn-detection.ts`, `lib/client-scoring.ts`, `lib/client-segmentation.ts`

## G.4 🟠 Operaciones en Lote (Bulk)

Selector múltiple en tablas admin. Acciones: «Subir 5%», «Desactivar seleccionados», «Exportar». Vista previa antes de confirmar. Aplica a pricing rules, clientes, empleados, inventario.
**Archivos:** `components/admin/BulkActionBar.tsx` (nuevo)

## G.5 🟠 Delegación Automática Configurable

El admin define reglas: «Alertas de inventario → Coordinador María (timeout 30 min). Disputas >$200 → Dueño (timeout 10 min).» El sistema enruta automáticamente sin pasar por el admin. El admin solo ve las que requieren su atención.
**Archivos:** `lib/autopilot-mode.ts`, `lib/unified-alerts.ts`

## G.6 🟠 Cash Flow Predictivo a 30 Días

Proyección de entradas vs. salidas con línea de fondo de emergencia. Alerta si la caja real cruzará bajo el umbral en los próximos 30 días. Datos del Shadow Ledger.
**Archivos:** `lib/shadow-ledger.ts`, `lib/cash-reserve.ts`

## G.7 🟠 Matriz de Rentabilidad Geoespacial (Mapa de Calor)

Mapa donde cada polígono de la ciudad se tiñe según margen neto real de los servicios allí ejecutados (últimos 30 días). Si Richmond Sur consistentemente <15% margen, el admin hace clic y ajusta el modificador de zona sin tocar Excel.
**Archivos:** `lib/zone-demand.ts`, `lib/zone-reparto.ts`

## G.8 🟠 Health-Check del Sistema (6 Semáforos)

Grid 2×4 actualizado cada 60s con drill-down al detalle. Cubre: Despacho, Inventario, Empleados, Legal, Pagos, PWA Sync, Event Bus.
**Archivos:** `lib/observability.ts`, `lib/backup-jobs.ts`

---

# PARTE H: PUBLICIDAD, MARKETING Y CRECIMIENTO

## H.1 🔴 Pipeline de Contenido SEO + Landing Pages Dinámicas

Keyword research local → calendario editorial estacional → templates SEO → landing pages por zona generadas con Next.js ISR. Ejemplo: `/richmond-norte/deep-cleaning` con datos reales del portafolio y precios locales.

## H.2 🔴 Infraestructura de Retargeting Multi-Canal

Pixel de Meta/Google en cotizador. Secuencia post-abandono: T+1h email, T+24h SMS, T+72h email con testimonio zonal, T+7d último intento. Sin descuento — protege LTV.

## H.3 🟠 Programa de Referidos Amplificado + Vecinal

Post-servicio exitoso (score >90): «¿Te gustó? Comparte tu código, gana $25, tu amigo gana $25.» Link personalizado. Dashboard de referidos para el cliente. Campaña de densidad vecinal: «Estamos en tu cuadra el martes. Refiere a un vecino → ambos nivel VIP.» Esto densifica rutas y reduce costo de tránsito.

## H.4 🟠 Recolección Sistemática de Testimonios

Post-servicio score >95: «Tu opinión en 1 clic: ⭐⭐⭐⭐⭐». Si 5★, segundo mensaje: «¿2 frases sobre tu experiencia?» → testimonial. Si <4★ → NO se publica, se abre ticket QC. Auto-publicación en Google Business Profile vía API.

## H.5 🟠 Ciclo Completo del Cliente (Full Funnel)

Marketing → Cotizador → CRM → Reserva → Pagos → Despacho → QC → Reviews → Referidos → Remarketing. Cada etapa con métricas visibles. Tickets alimentan score interno y campañas de recuperación. Inventario alimenta costos reales. Nómina retroalimenta costo por servicio.

## H.6 🟠 Publicidad Predictiva por Datos de BC Assessment

Si BC Assessment indica que un clúster de casas fue construido en la misma década, dirigir publicidad hiper-localizada: «Es temporada de lluvia en [Barrio]. ¿Hace cuánto no desinfecta los pisos de madera de su casa original de 1990?» No se vende limpieza — se vende preservación del patrimonio.

## H.7 🟡 Chat de Captura en Website

Widget de 3 preguntas (árbol de decisión, no LLM) que captura leads calificados sin fricción de formulario. «¿Qué tipo de propiedad? ¿Cuándo necesita servicio? ¿Algo especial que debamos saber?» → cotización instantánea o callback.

## H.8 🟡 Campañas Estacionales Automatizadas con Candado de Inventario

Calendario pre-cargado para Richmond: Marzo Spring Cleaning, Mayo Move-out, Jul-Ago Vacation Rental, Octubre Pre-Holiday Deep, Diciembre Gift Cards + Recovery. Cada campaña requiere verificación de stock antes de activarse (ver C.3).

## H.9 🟡 Analítica de Competencia en Tiempo Real

Dashboard: precios de 3-4 competidores locales, benchmark de reputación por zona postal, alertas por cambio >10% en competidores. Sugerencia automática de ajuste.

---

# PARTE I: GUÍA DE IMPLEMENTACIÓN POR ROL — QUÉ VE CADA PERSONA Y POR QUÉ

## I.1 El Cliente (por qué paga $70+/hr)

| Momento | Qué ve | Por qué se queda |
|---------|--------|------------------|
| Landing | «Servicio de limpieza en [SU ZONA]» + foto real + «12 servicios esta semana aquí» | Se siente local, no genérico |
| Cotización | Calculadora de valor del tiempo: «Recupere 4.5h por $315». Desglose completo | Ve inversión, no costo |
| Checkout | Badge Garantía Lulu + Perfil anónimo del equipo (4.9★, habla mandarín) | Confía antes de abrir la puerta |
| Día del servicio | Portal en vivo: ETA + zonas completadas + productos usados | No está ansioso |
| Post-servicio | Galería con fotos + Nota de Cuidado del equipo + Home Health Report | Siente que cuidaron su hogar |
| Garantía | «Revise contra la evidencia. ¿No coincide? Re-servamos.» | Sabe que tiene respaldo |
| Recurrente | «Próximo servicio sugerido en 21 días. Reserve en 1 toque.» | El sistema piensa por él |

## I.2 El Empleado (por qué se queda)

| Momento | Qué ve | Por qué se queda |
|---------|--------|------------------|
| Pre-jornada | Checklist: sueño, ánimo, clima, ruta. Alerta si batería <30% | Se siente cuidado, no vigilado |
| Inicio | «Hoy: 2 servicios. Ganancia proyectada: $184.» | Ve impacto financiero inmediato |
| En campo | SOP con poka-yoke químico (color+ícono). Voz: «Completar zona cocina» | No memoriza química; el sistema protege |
| Cierre | «Day Rate $90 + comisiones $12.50 = $102.50. Insignia Oro: 42/50.» | Progreso tangible (dinero + carrera) |
| Post-jornada | Chat del equipo (160 chars, 7 días) + Ranking semanal Top 3 anónimo | Comunidad sin toxicidad |
| Crisis | Botón SOS → «Admin contactado. Su seguridad es prioridad.» | El sistema respalda, no juzga |
| Quincena | «Proyectado: $1,230. Próximo depósito: viernes 15.» | Sin ansiedad financiera |

## I.3 El Admin (por qué duerme tranquilo)

| Momento | Qué ve | Por qué duerme tranquilo |
|---------|--------|--------------------------|
| Mañana | Panel de salud: 6 semáforos. Todo verde = café en paz | El sistema se monitorea solo |
| 5:30 PM | Ciclo de despacho: propuesta óptima + simulador «¿y si activo +1 equipo?» | Decide con datos |
| 7:00 PM | Batch Capture ejecutado. Shadow Ledger vs QBO: 0.0% divergencia | El dinero fluye correcto |
| Crisis | Bandeja unificada: «Disputa $180 — timeout 10 min. Asignado a usted.» | Nada se pierde; todo tiene dueño |
| Delegación | «Inventario bajo → Coordinador María. Disputa >$200 → Usted.» | No es cuello de botella |
| Finanzas | Cash flow 30 días: línea azul sobre fondo de emergencia | Sin sorpresas de liquidez |
| Noche | Alerta burnout: «No ha revisado QC en 10 días.» | El sistema lo cuida a él también |

---

# PARTE J: MATRIZ DE PRIORIZACIÓN UNIFICADA

| # | Hallazgo | Clase | Esfuerzo | Impacto | Etapa |
|---|----------|-------|----------|---------|-------|
| C.2 | Inventario ↔ Despacho (verificación de insumos) | 🔴 | 3-5d | Operacional | E3 |
| C.4 | Clima → Despacho (override automático) | 🔴 | 2-3d | Seguridad | E3 |
| C.6 | PWA Heartbeat (empleado no incomunicado) | 🔴 | 1-2d | Seguridad laboral | E4 |
| C.7 | Protocolo Emergencia Personal (flujo post-abort) | 🔴 | 3-5d | Legal/Seguridad | E4 |
| C.1 | Despacho → Nómina (horas reales) | 🔴 | 3-5d | Operacional | E3+E9 |
| C.3 | Marketing → Inventario (candado campañas) | 🔴 | 2-3d | Operacional | E10 |
| C.5 | QC → Reentrenamiento + SOP feedback | 🔴 | 2-3d | Calidad | E5+E8 |
| C.8 | Shadow Ledger ↔ QBO (reconciliación) | 🔴 | 3-4d | Contable | E9 |
| C.9 | Anti-Gaming Cliente (score de fricción) | 🔴 | 2-3d | Margen | E5 |
| C.10 | Período de Gracia Recurrente (15 días) | 🔴 | 2-3d | Retención | E2 |
| C.11 | Command Center Unificado | 🔴 | 5-7d | Control | E7 |
| C.12 | Simulador de Escenarios | 🔴 | 5-7d | Estrategia | E9 |
| C.13 | Retargeting Cotizaciones Abandonadas | 🔴 | 2-3d | Crecimiento | E10 |
| C.14 | Panel de Salud del Sistema (6 semáforos) | 🔴 | 2-3d | Operacional | E0+E9 |
| C.15 | Carga Biomecánica (hard-block despacho) | 🔴 | 3-5d | Seguridad laboral | E8 |
| C.16 | Pipeline SEO Automatizado | 🔴 | 3-5d | Crecimiento | E10 |
| D.8 | Pricing ↔ Competitor Tracking | 🟠 | 2-3d | Estrategia | E9 |
| D.9 | Legal Monitoring → Operaciones | 🟠 | 2-3d | Compliance | E9 |
| D.10 | Cliente ↔ Admin (hilo de comunicación) | 🟠 | 1-2d | Experiencia | E5 |
| E.1.1 | Tracking en Vivo del Servicio | 🟠 | 3-4d | Experiencia | E4 |
| E.1.2 | Perfil Público del Equipo | 🟠 | 1-2d | Confianza | E1 |
| E.1.3 | Galería con Home Health Report | 🟠 | 3-4d | Lealtad | E5 |
| E.1.4 | Garantía Explícita Visible | 🟠 | 1d | Confianza | E5 |
| E.1.5 | Calculadora de Valor del Tiempo | 🟠 | 1d | Conversión | E1 |
| E.1.6 | Programa de Lealtad Visible | 🟠 | 3-4d | Retención | E5 |
| E.1.7 | Portal de Preferencias Reales | 🟠 | 3-5d | Experiencia | E5 |
| E.1.8 | Centro Documental del Cliente | 🟠 | 2-3d | Experiencia | E5 |
| F.1 | Auto-Evaluación Post-Jornada | 🟠 | 2-3d | Bienestar | E8 |
| F.2 | Reporte de Equipo Dañado | 🟠 | 2-3d | Operacional | E4 |
| F.5 | Previsibilidad Financiera Empleado | 🟠 | 2-3d | Retención | E8 |
| F.8 | Marketplace de Turnos | 🟠 | 3-4d | Flexibilidad | E8 |
| G.3 | Ciclo de Vida del Cliente (Health Score) | 🟠 | 3-4d | Retención | E9 |
| G.4 | Operaciones en Lote (Bulk) | 🟠 | 3-4d | Eficiencia | E7 |
| G.6 | Cash Flow Predictivo 30 Días | 🟠 | 3-4d | Supervivencia | E9 |
| G.7 | Mapa de Calor de Rentabilidad | 🟠 | 3-4d | Estrategia | E9 |
| H.3 | Referidos Amplificados + Vecinales | 🟠 | 2-3d | Crecimiento | E10 |
| H.4 | Recolección Sistemática Testimonios | 🟠 | 2-3d | Reputación | E10 |
| H.5 | Full Funnel Tracking | 🟠 | 3-4d | Estrategia | E10 |
| H.6 | Publicidad Predictiva BC Assessment | 🟠 | 2-3d | Crecimiento | E10 |
| F.3 | Carga Biomecánica (datos) — duplicado de C.15 | (ver C.15) | — | — | — |
| F.4 | Preferencias de Disponibilidad | 🟡 | 2-3d | Bienestar | E8 |
| F.6 | Métricas Personales Visibles | 🟡 | 2-3d | Motivación | E8 |
| F.7 | Chat Empleado→Admin Diferido | 🟡 | 2-3d | Comunicación | E8 |
| F.9 | Onboarding Digital | 🟡 | 3-4d | Experiencia | E8 |
| F.10 | Objetivos y Reconocimientos | 🟡 | 2-3d | Motivación | E8 |
| G.5 | Delegación Automática Configurable | 🟡 | 2-3d | Eficiencia | E7 |
| G.8 | Health-Check Sistema (ya cubierto en C.14) | (ver C.14) | — | — | — |
| H.7 | Chat de Captura Website | 🟡 | 2-3d | Conversión | E10 |
| H.8 | Campañas Estacionales Automatizadas | 🟡 | 2-3d | Crecimiento | E10 |
| H.9 | Analítica Competencia Real-Time | 🟡 | 2-3d | Estrategia | E9 |

---

# PARTE K: INVARIANTES AMPLIADOS (APLICAN SIEMPRE)

Se agregan al listado B.2 del v8.3:

- **B.2.26** Interconexión Inventario-Despacho: Ningún equipo se asigna si `stock < consumo_sop + 20% buffer`.
- **B.2.27** Canal Telefónico Parity: Toda reserva telefónica usa el mismo motor de precios que la web. El coordinador nunca ingresa datos manualmente.
- **B.2.28** Fallback Progresivo: Si Autopilot dispara el mismo fallback >3 veces en 1h para la misma entidad → escala a Coordinador. 4º intento → bloqueo manual.
- **B.2.29** Gate Financiero: Pausa automática de marketing pagado, regalos y contratación si fondo de emergencia < `(Nómina_Quincenal × 2) + (Fijos_Mensuales × 1)`.
- **B.2.30** Carga Biomecánica: Hard-block en despacho si índice acumulado > umbral en 72h.
- **B.2.31** Bloqueo Transaccional de Campañas: Marketing no activa campaña sin `proyección_inventario_14d >= demanda_estimada`.
- **B.2.32** Período de Gracia Recurrente: 15 días tras fallo de pago antes de pausar servicios.
- **B.2.33** Anti-Gaming Cliente: Si `tickets / servicios > 25%` → bloqueo de reservas esporádicas + exigencia de Auditor.

---

# PARTE L: GLOSARIO AMPLIADO

**Anti-Gaming Cliente:** Sistema que detecta abuso de garantía mediante ratio tickets/servicios y aplica restricciones progresivas.
**Blast Radius:** Simulación de impacto operativo y financiero ante la pérdida de un recurso crítico (líder de equipo).
**Carga Biomecánica:** Índice 1-5 que mide el desgaste físico de un servicio, usado para prevenir fatiga acumulada y lesiones.
**Cash Flow Predictivo:** Proyección de entradas vs. salidas a 30 días con alerta si la caja cruza bajo el fondo de emergencia.
**Centro de Transparencia:** Portal en vivo donde el cliente ve ETA, progreso de zonas y productos usados durante el servicio.
**Command Center:** Dashboard unificado que consolida estado operativo, financiero, legal y de sistema en una sola pantalla.
**Customer Health Score:** Score interno del cliente (visible solo al admin) que mide rentabilidad, frecuencia, disputas y riesgo de churn.
**Delegación Automática:** Reglas configurables para que alertas específicas se enruten a coordinadores sin pasar por el admin.
**Full Funnel:** Ciclo completo del cliente desde marketing hasta remarketing, con métricas en cada etapa.
**Home Health Report:** Reporte post-servicio que transforma datos de limpieza en recomendaciones de mantenimiento del hogar.
**Landing Page Dinámica:** Página SEO generada por zona y servicio con Next.js ISR usando datos reales del portafolio.
**Nota de Cuidado:** Mensaje de 140 chars (o voz transcrita) del equipo al cliente, humanizando la entrega del servicio.
**Perfil Público del Equipo:** Stats anónimas del equipo (score, certificaciones, idiomas) visibles al cliente antes de reservar.
**Período de Gracia Recurrente:** 15 días tras fallo de pago recurrente donde el servicio continúa pero el portal se bloquea hasta pago.
**Score de Fricción del Cliente:** Ratio tickets/servicios que detecta clientes de alto mantenimiento y dispara acciones de protección de margen.
**Semáforos del Sistema:** Grid de indicadores visuales (🟢🟡🔴) para monitorear salud operativa en tiempo real.

---

*Documento consolidado el 4 de Agosto, 2026. Integra el análisis original v0.2 con las contribuciones del Anexo de Vulnerabilidades, la Auditoría Crítica y la Evolución Arquitectónica v0.2 (B.14→B.33).*
*Principio rector: el sistema existe para tres personas — el cliente que paga, el empleado que limpia, y el dueño que duerme tranquilo. En ese orden.*
