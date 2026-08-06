# MEJORAS v8.3 — ANEXO ARQUITECTÓNICO v0.2
## Sistema Operativo de Aseo | Lulu Island Flagship

**Documento:** Mejoras8.3v0.2
**Fecha:** 4 de Agosto, 2026
**Jurisdicción:** British Columbia, Canadá
**Relación con v8.3 y v0.1:** Este documento es una evolución obligatoria del v0.1. Todo lo aquí adoptado se integra al plan de construcción. Revisa, complementa y en algunos casos corrige el v0.1. El v0.2 no invalida el v0.1; lo extiende.
**Principio rector:** La arquitectura debe servir al negocio, no al revés. Cada línea de código que no resuelve un problema real de limpieza es una línea que tendremos que mantener mañana.

---

# PARTE A: ANÁLISIS DE HUECOS IDENTIFICADOS (v8.3 vs v0.1)

Esta parte documenta lo que falta para que el sistema sea *coherente de punta a punta*: que el cliente pague feliz, que el empleado no se vaya, que el admin no se vuelva loco, y que el negocio crezca sin depender de la memoria de una sola persona.

---

## A.1 Huecos de Interconexión Módulo-Cliente

**Problema:** El cliente paga, pero su visión del servicio termina en la cotización y reinicia en la galería post-servicio. Hay un *agujero  * de 3-5 horas donde no sabe qué pasa en su casa.

**Huecos específicos:**
1. **No hay "progreso en vivo".** El v8.3 menciona GPS del vehículo (E3), pero no el progreso del servicio (zonas completadas). El cliente no sabe si van por la mitad o ya terminan.
2. **No hay "perfil del equipo" pre-servicio.** El cliente reserva sin saber *quién* viene. No pide nombre, pero sí quiere saber: "¿Es un equipo verificado? ¿Cuántos servicios han hecho esta semana? ¿Hablan mi idioma?" Esto es especialmente crítico para B2B (Airbnb hosts) y clientes recurrentes.
3. **No hay "centro de transparencia".** Un solo lugar donde el cliente vea: historial de servicios, fotos de cierre acumuladas, consumo de productos (para clientes Eco), certificaciones del equipo que atendió su hogar, y garantía activa.
4. **El canal telefónico (B.7 del v0.1) no está conectado al portal del cliente.** Un cliente que reserva por teléfono no tiene acceso web posterior (a menos que el coordinador le cree cuenta), generando una brecha de experiencia.

---

## A.2 Huecos de Valor Percibido (Website y Portal)

**Problema:** El v8.3 define posicionamiento premium (B.2.24, E10.1) pero no traduce ese posicionamiento a *elementos de UI concretos* que generen confianza suficiente para justificar $70+/hr.

**Huecos específicos:**
1. **Falta "calculadora de valor del tiempo".** Mostrar el precio no basta. Hay que mostrar: "Usted invierte 6 horas limpiando = $X en salario/hora de su tiempo. Nosotros se lo devolvemos por $Y." El valor no es la limpieza; es el tiempo recuperado.
2. **Falta "garantía visible y clicable".** La garantía relacional a evidencia (E2.4) es operativa, pero el cliente no la *ve* antes de pagar. Necesita un badge "Garantía Lulu: si no coincide con la foto de cierre, re-servamos gratis" en el checkout.
3. **Falta "social proof operativo".** No basta con reseñas estáticas. El website debería mostrar: "Equipo Jade acaba de completar un Deep Clean en Steveston — 5★" en tiempo real (anónimo, con delay de 15 min).
4. **Falta "transparencia de productos".** Clientes premium (especialmente con mascotas/alergias) quieren saber *qué* productos se usan. El SOP (D.6) tiene esta info, pero no se expone al cliente.
5. **Falta "modo Eco" como upsell visible.** El v8.3 lo menciona en E11, pero no hay flujo de cotización que permita al cliente elegir "Modo Eco +$15" desde E1.

---

## A.3 Huecos del Módulo Empleado (PWA y más allá)

**Problema:** El v8.3 E8 cubre bienestar, gamificación y carrera, pero trata al empleado como *operario*, no como *profesional de servicio*. En un mercado con escasez de mano de obra ($18.25/hr mínimo, competencia feroz), la retención depende de *dignidad digital*.

**Huecos específicos:**
1. **Falta "modo manos libres".** El líder trabaja con guantes, productos, y a veces en escaleras. Sacar la tablet para reportar un daño o completar una zona es fricción. Falta: comando de voz para "reportar daño", "completar zona cocina", "timer 10 minutos".
2. **Falta "proyección financiera personal".** El empleado ve su Day Rate diario, pero no sabe: "Si mantienes este ritmo, esta quincena serán $X. Te faltan $Y para la insignia de Oro." Esto es retención pura.
3. **Falta "marketplace de turnos".** Si María quiere cubrir un turno de Pedro, hoy necesita WhatsApp + aprobación admin. Debería ser un toggle en la PWA: "Disponible para cubrir viernes en Richmond-Norte" -> notificación a admin -> aprobación de un toque.
4. **Falta "nota de cuidado" para el cliente.** El equipo termina, ve algo (ej: "la planta de la ventana necesita más luz"), pero no hay canal para dejar una nota cálida que el cliente vea en su galería. Esto humaniza el servicio y genera reseñas 5★.
5. **Falta "historial de aprendizaje".** Las certificaciones 3 niveles (E3.1) existen, pero el empleado no ve su progreso de habilidades (ej: "Nivel 2 Químicos: 80% completado. Próximo módulo: Ácidos seguros").
6. **Falta "soporte emocional / crisis".** El v8.3 tiene aborto seguro (D.10.7), pero no una línea de recursos (llamada anónima a servicio de salud mental, chat con coordinador) para el empleado que reporta "ánimo 😟" 3 días seguidos.

---

## A.4 Huecos de Control Administrativo

**Problema:** El admin tiene bandeja unificada (E0.6), fallback de 10 min (B.2.12) y dashboard 4+1 (D.13), pero no tiene *visión sistémica* ni *herramientas de delegación inteligente*.

**Huecos específicos:**
1. **Falta "simulador de escenarios".** El admin no puede preguntar: "¿Cuánto mejora el margen si activo 2 equipos más mañana?" o "¿Qué pasa si bajo la tarifa objetivo a $65 en Richmond-Sur?" Hoy requiere Excel manual.
2. **Falta "panel de salud del sistema".** No solo finanzas. Un semáforo que diga: "Despacho: verde | Inventario: amarillo (paños azules < mínimo) | Empleados: verde | Legal: verde (último feed hace 2 días) | QBO: rojo (sin sync 6h)".
3. **Falta "delegación automática con reglas".** Cuando el admin está ausente, todo cae al Fallback de 10 min. Pero debería poder configurar: "Si alerta = inventario bajo -> delegar a Coordinador X. Si alerta = disputa post-cobro >$200 -> delegar a Admin (yo)."
4. **Falta "audit trail visual".** El `audit_log` (B.11.1) es tabular. El admin necesita una *línea de tiempo visual* de decisiones: "5:30 PM: Sistema publicó horario. 5:45 PM: Admin movió Orden #123 a Equipo B. 6:00 PM: Regla de precio cambió." Esto es crítico para debuggear sin ser DBA.
5. **Falta "comando de voz" para Admin Mobile.** El admin en campo (visita a cliente, inspección) necesita decir: "Crear ticket para 123 Main St" sin escribir en una pantalla pequeña.

---

## A.5 Huecos de Publicidad y Adquisición

**Problema:** El v8.3 E10 tiene marketing, pero está desconectado del producto. La publicidad no se alimenta de la operación; es un silo.

**Huecos específicos:**
1. **Falta "retargeting de cotización abandonada".** El cliente llega a cotizar, no reserva, y se va. No hay secuencia automática: email 1h después ("¿Dudas? Aquí hablamos español"), SMS 24h ("Su cotización sigue vigente"), descuento relación 72h (solo si es cliente previo).
2. **Falta "landing pages dinámicas por zona/código postal".** Un cliente en Steveston debería ver: "Servicio de limpieza en Steveston — Equipos locales" con foto de una casa típica de la zona, no genérica.
3. **Falta "programa de referidos B2B".** El v8.3 tiene partners (E10.6), pero no un portal donde el property manager vea: "Usted ha referido 3 clientes. Su comisión acumulada: $450. Su T4A está disponible."
4. **Falta "contenido operativo como marketing".** "Esta semana eliminamos 340kg de polen de hogares de Richmond" (dato real del sistema) es más poderoso que un blog genérico.
5. **Falta "Google Local Services Ads" integrado.** El v8.3 menciona SEO/GBP, pero no LSAs, que son el canal de pago más eficiente para servicios locales en Canadá.
6. **Falta "chat de captura" en website.** No un chatbot LLM (rechazado en C.9), sino un widget de 3 preguntas: "¿Cuántos baños? ¿Mascotas? ¿Cuándo lo necesita?" -> lead calificado -> reserva acelerada.

---

## A.6 Huecos Técnicos y de Arquitectura

**Huecos específicos:**
1. **Falta "Schema Registry" para eventos.** El v0.1 B.1 define eventos con Zod, pero no un registro central donde un módulo declare "yo produzco X" y otro declare "yo consumo Y", generando documentación automática de dependencias.
2. **Falta "health check unificado" entre módulos.** Cada adaptador (Stripe, QBO, Twilio, Maps) debería exponer un endpoint `/health` que el admin vea en un panel. Hoy solo hay health-check legal (B.11.2).
3. **Falta "contrato OpenAPI" visible.** Los contratos Zod (B.3) son código; el dueño y futuros devs necesitan una UI que muestre: "Cotizador expone POST /quote. Input: {...}. Output: {...}. Último test: verde."
4. **Falta "gestión predictiva de activos" (más allá de vehículos).** Los vaporizadores, aspiradoras HEPA y herramientas caras tienen ciclos de vida. No hay seguimiento de "horas de uso" vs. "mantenimiento programado".
5. **Falta "pipeline de calidad del aire".** Para clientes Eco y alérgicos, medir VOCs/PM2.5 post-servicio con un sensor portátil (costo ~$80) generaría un reporte "Antes/Después" que justifica el precio premium. Diferenciador real vs. competencia.


---

# PARTE B: MEJORAS ADOPTADAS (Nuevas y Refinadas)

---

## B.15 Centro de Transparencia del Cliente (ADOPTADO en E1/E5)

**Estado:** Obligatorio en E1 (esquema) + E5 (UI).
**Razón:** Cierra el agujero   entre reserva y galería. El cliente que paga premium merece saber qué pasa en su propiedad sin ser invasivo.

### B.15.1 Funcionalidad

Página `/portal/servicio/:orden_id` accesible desde SMS/email (sin login para clientes recurrentes con link mágico TTL 24h; con login para nuevos):

| Sección | Contenido | Fuente de datos |
|---------|-----------|-----------------|
| **Quién viene** | Nombre del equipo (anónimo: "Equipo Jade"), foto del vehículo (placa parcial), certificaciones vigentes ("Nivel 2 Químicos"), idiomas hablados. | `equipo` + `empleado` (filtrado) |
| **ETA en vivo** | GPS del vehículo (no persona), actualizado cada 60 seg. Mapa simplificado (solo calles, no satélite). | `gps_log` |
| **Progreso del servicio** | Zonas completadas (ej: "Cocina ✓, Baño ✓, Sala en curso..."). No fotos en vivo (privacidad); solo checklist de zonas. | `zona_limpieza` + estado PWA |
| **Productos usados** | Lista de productos del SOP para su tipo de servicio, con badges Eco si aplica. | `sop` + `inventario` |
| **Garantía activa** | Texto: "Su servicio tiene garantía Lulu hasta el Batch Capture de hoy 7:00 PM. Reporte discrepancias aquí." | `orden_servicio` + reglas E2 |
| **Nota de cuidado** | Nota opcional del equipo (ej: "Cuidamos especialmente la zona de mascotas. Recomendamos ventilar 30 min post-servicio."). | `nota_operativa` (tipo `cuidado_cliente`) |

### B.15.2 Reglas de privacidad
- No se muestra nombre individual de empleado (solo "Equipo X").
- GPS se congela cuando el vehículo está estacionado >10 min (no revela paradas personales).
- Fotos de cierre solo aparecen POST servicio, nunca en vivo.
- El cliente puede desactivar "progreso en vivo" en su perfil (default: activo).

### B.15.3 Implementación
- Edge Function `portal_transparencia` que agrega datos de 4 tablas (equipo, gps_log, orden, sop) en una sola respuesta cacheada 30 seg.
- PWA publica `zona.completada` (ya en B.1.1) -> Event Bus -> actualiza cache del portal.

---

## B.16 Perfil Público Anónimo del Equipo (ADOPTADO en E1)

**Estado:** Obligatorio en E1 (datos) + E3 (exposición).
**Razón:** Antes de reservar, el cliente quiere confiar. "Equipo Jade — 47 servicios esta semana, 4.9★ promedio, certificado Nivel 3, habla inglés/mandarín" genera más conversión que cualquier copy de marketing.

### B.16.1 Funcionalidad
- En el cotizador (paso final antes de checkout): carrusel de "Equipos que podrían atender su zona" con stats anónimas.
- Stats: servicios esta semana (rango: "30-50"), score promedio del equipo (semáforo: verde >80, amarillo 70-80), certificación máxima, idiomas.
- **No es elección del cliente.** El sistema asigna; esto es *transparencia*, no marketplace.

### B.16.2 Implementación
- Materialized view `vw_equipo_stats_semanal` recalculada cada domingo 6 AM.
- Edge Function `equipo_perfil_publico` que lee la view y anonimiza (rango de servicios, no IDs reales).

---

## B.17 Asistente de Voz y Modo Manos Libres en PWA (ADOPTADO en E4)

**Estado:** Obligatorio en E4.
**Razón:** El líder lleva guantes, manos mojadas, y a veces está en escaleras. La tablet no es un dispositivo de manos; es un dispositivo de referencia.

### B.17.1 Comandos de voz (Web Speech API, offline con modelos locales ligeros)

| Comando | Acción | Confirmación |
|---------|--------|--------------|
| "Completar zona cocina" | Marca zona como completada. Requiere checklist 100% verde; si no, responde: "Faltan 2 ítems en cocina." | TTS: "Cocina completada. Siguiente: baño." |
| "Reportar daño" | Abre modal de daño, inicia grabación de audio 30 seg + foto. | TTS: "Daño registrado. Continúe." |
| "Timer diez minutos" | Timer para superficie caliente (D.7) o descanso. | TTS + vibración al finalizar. |
| "Nota de cuidado" | Graba audio 15 seg -> transcribe (Whisper local o Edge Function) -> guarda como `nota_operativa`. | TTS: "Nota guardada para el cliente." |
| "Modo guante grueso" | Igual que swipe (B.9.1), pero por voz. | UI cambia + TTS: "Botones ampliados." |

### B.17.2 Reglas
- El micrófono solo escucha cuando el líder mantiene presionado un botón grande ("Hablar") o dice la palabra clave "Lulu" (configurable, default: apagado por privacidad).
- Todo audio se procesa localmente; nunca se envía a la nube sin consentimiento explícito del empleado (registro en `empleado.consentimiento_voz`).
- Si el empleado no consiente voz: modo manos libres se desactiva, pero los botones grandes (B.9.1) siguen funcionando.

---

## B.18 Simulador de Escenarios para Admin (ADOPTADO en E3/E9)

**Estado:** Obligatorio en E9 (panel admin).
**Razón:** El admin toma decisiones con consecuencias de $$$. Necesita jugar con los números antes de aplicarlos.

### B.18.1 Escenarios pre-cargados

| Escenario | Variables | Output |
|-----------|-----------|--------|
| "Activar N equipos" | N (1-5), zona, día | Costo laboral adicional, ingreso proyectado, margen neto, riesgo de bench no asignado. |
| "Cambiar tarifa objetivo" | Nueva tarifa | Recálculo de las 20 celdas, impacto en órdenes pasadas (simulado), proyección de conversión. |
| "Ajustar HHE" | Tipo + ft² + nuevo HHE | Impacto en capacidad diaria, ingreso, y sugerencia de si el ajuste es rentable. |
| "Crisis de cash flow" | % caída de reservas (10%, 30%, 50%) | Palancas automáticas en orden: pausar regalos -> reducir zonas -> renegociar fijos -> alerta quiebra. |

### B.18.2 Implementación
- Edge Function `simular_escenario` que corre el motor de precios y despacho con datos sintéticos o snapshot de producción (modo sombra).
- Resultado: JSON con gráfico simple (SVG) que el admin ve en 2 segundos.
- **No es BI.** Es una función pura con inputs/outputs predecibles. Sin infraestructura nueva.

---

## B.19 Social Proof Dinámico y Retargeting (ADOPTADO en E1/E10)

**Estado:** Obligatorio en E1 (datos) + E10 (marketing).
**Razón:** La desconfianza es el principal freno en servicios de limpieza (entran a tu casa). El social proof reduce CAC.

### B.19.1 Social proof en website
- Widget en cotizador: "[Anónimo] en [Zona] acaba de reservar un [Tipo] — hace X min".
- Datos: `orden_servicio` con delay de 15 min, anonimizado a zona (no dirección exacta).
- Frecuencia: máx 1 por minuto, no spam.

### B.19.2 Retargeting de cotización abandonada
- Secuencia automática (catálogo de comunicaciones E6):
  - T+1h: Email ("¿Dudas? Pregúntenos por chat o llámenos. Hablamos español/mandarín.").
  - T+24h: SMS ("Su cotización para [fecha] sigue vigente. Reserve ahora: [link].").
  - T+72h: Email con testimonio de cliente de su misma zona ("María en Steveston: 'El equipo Jade fue increíble...'").
  - T+7 días: Último intento. Si no convierte, tag como "dormido" para campaña de reactivación (E10.9).
- **Exclusión:** Clientes recurrentes no reciben descuento en retargeting (protege LTV).

---

## B.20 Notas de Cuidado Cliente-Equipo (ADOPTADO en E4/E5)

**Estado:** Obligatorio en E4 (captura) + E5 (exposición).
**Razón:** Humaniza el servicio. Una nota cálida del equipo genera más reseñas 5★ que cualquier recordatorio de SMS.

### B.20.1 Flujo
1. En cierre de servicio (PWA), el líder puede dejar una "Nota de cuidado" (texto 140 chars o voz transcrita).
2. Ejemplos: "Cuidamos especialmente la zona de mascotas. Recomendamos ventilar 30 min." / "La campana quedó impecable. El desengrasante funciona mejor con calor moderado." / "Encontramos una pequeña filtración bajo el lavamanos. Sugerimos revisar plomería."
3. La nota aparece en la galería post-servicio del cliente (B.15.1) y en el email de cierre.
4. **Regla:** Nunca diagnóstico médico (PIPEDA), nunca crítica al cliente ("muy sucio"), nunca solicitud de propina. El sistema valida con NLP simple (lista negra de frases) antes de enviar.

---

## B.21 Pipeline de Calidad del Aire / Ambiente (ADOPTADO como DIFERIDO E11)

**Estado:** ⏸️ DIFERIDO a E11. Feature flag `calidad_aire` APAGADO.
**Razón:** Es un diferenciador premium real, pero requiere hardware ($80 sensor VOC/PM2.5) y protocolo de medición. No es MVP.

### B.21.1 Concepto
- Sensor portátil (ej: IQAir AirVisual o similar con API) en el kit del líder.
- Medición "antes" (T_in) y "después" (T_out) en 3 puntos de la casa.
- Reporte en galería del cliente: "Calidad del aire: Antes PM2.5 = 45 μg/m³ -> Después = 8 μg/m³. Nivel: Excelente."
- **Gate de activación:** >20% de clientes eligen "Modo Eco" (B.27) durante 2 meses consecutivos.

---

## B.22 Gestión Predictiva de Activos (ADOPTADO en E7)

**Estado:** Obligatorio en E7.
**Razón:** El v8.3 gestiona vehículos, pero no herramientas caras (vaporizador $800, HEPA $600). Su fallo en campo = servicio fallido.

### B.22.1 Tabla `activo_equipo`
- Campos: `tipo` (vaporizador, HEPA, aspiradora industrial), `horas_uso_acumuladas`, `fecha_ultimo_mantenimiento`, `frecuencia_mantenimiento_horas`, `estado` (activo/mantenimiento/baja), `equipo_asignado`.
- Alerta: `horas_uso` > `frecuencia` × 0.8 -> "Mantenimiento programado en 2 semanas."
- Bloqueo: `horas_uso` > `frecuencia` × 1.1 -> "No asignable hasta mantenimiento."

### B.22.2 Conexión a PWA
- Al inicio de jornada, checklist incluye: "Vaporizador: 1,240h/1,500h (verde). HEPA: 890h/1,000h (amarillo — programar)."

---

## B.23 Schema Registry y Documentación Automática (ADOPTADO en E0)

**Estado:** Obligatorio en E0.
**Razón:** El v0.1 B.1 define eventos, pero no un registro central. Sin esto, el dueño no sabe qué módulo depende de qué.

### B.23.1 Implementación
- Tabla `schema_registry` (dueño: `modulo_eventos`):
  - `event_type`, `producer_module`, `consumer_modules[]`, `schema_json` (Zod), `last_updated`.
- Edge Function `registry_sync` que lee todos los `events.ts` del monorepo y sincroniza la tabla en CI.
- Panel admin: grafo visual de dependencias ("Cotizador produce `cotizacion.generada`. Consumen: Analytics, Precios, Despacho.").

### B.23.2 Health check unificado
- Cada adaptador (Stripe, QBO, Twilio, Maps) expone función `health()` que retorna: `status` (green/yellow/red), `last_success`, `latency_ms`, `error_rate_1h`.
- Panel admin: grid de 6 celdas (uno por adaptador) + 1 celda por módulo crítico (Despacho, Pagos, PWA Sync).
- Alerta: cualquier celda roja >5 min -> bandeja unificada (P1).

---

## B.24 Consentimiento de Voz y Grabación (ADOPTADO en E6)

**Estado:** Obligatorio en E6.
**Razón:** El v0.1 B.13 propone IVR/LLM, y B.17 propone voz en PWA. En BC, la grabación de voz requiere consentimiento (PIPEDA + CRTC).

### B.24.1 Reglas
- **Llamadas IVR:** "Esta llamada puede ser grabada para mejorar nuestro servicio. Presione 1 para aceptar, 2 para continuar sin grabación."
- **PWA (notas de voz del empleado):** Consentimiento en onboarding ("¿Autoriza el uso del micrófono para comandos de voz y notas de servicio?"). Revocable en perfil.
- **Almacenamiento:** Audios de empleado: TTL 30 días, luego transcrito a texto, audio eliminado. Audios de cliente (IVR): TTL 2 años (disputas), luego purge.
- **Tabla:** `consentimiento_voz` (append-only) con `timestamp`, `ip`, `version`, `scope` (empleado_pwa / cliente_ivr).

---

## B.25 Cash Flow Predictivo y Alertas de Tesorería (ADOPTADO en E2/E9)

**Estado:** Obligatorio en E2 (datos) + E9 (panel).
**Razón:** El v8.3 B.10 tiene gate financiero reactivo. Falta proyección.

### B.25.1 Funcionalidad
- Proyección 30 días basada en:
  - Entradas: órdenes confirmadas (100%), órdenes pendientes de pago (80% probabilidad), Holds autorizados (90%).
  - Salidas: nómina quincenal (100%), fijos mensuales (prorrateados), POs aprobadas (100%), chargebacks estimados (2%).
- Gráfico simple en admin: línea verde (entradas proyectadas) vs. línea roja (salidas fijas) vs. línea azul (caja real).
- Alerta: si la línea azul cruza bajo el fondo de emergencia (B.10.1) en cualquier punto de los próximos 14 días -> alerta roja + bloqueo de gastos discrecionales.

---

## B.26 Landing Pages Dinámicas por Zona (ADOPTADO en E10)

**Estado:** Obligatorio en E10.
**Razón:** "Limpieza en Richmond" es genérico. "Limpieza de Deep Clean en Steveston para casas 1,500 ft²" convierte 3× más.

### B.26.1 Implementación
- Ruta: `/limpieza/[zona]/[tipo]` (ej: `/limpieza/steveston/deep-clean`).
- Generadas en build time desde `zona_limpieza` + `reglas_precio` + fotos del Live Portfolio filtradas por zona.
- Contenido dinámico:
  - Hero: foto de una casa típica de la zona (del Live Portfolio, anonimizada).
  - Precio base: precio de la celda correspondiente (D.2) para ft² promedio de la zona.
  - Social proof: "12 servicios esta semana en Steveston".
  - SEO: H1 "Servicio de Deep Clean en Steveston, Richmond BC".
- **Sin infra nueva:** Next.js ISR (Incremental Static Regeneration) con revalidación diaria.

---

## B.27 Modo "Coordinador" — Integración Completa (ADOPTADO en E1/E6)

**Estado:** 🚨 **BLOQUEANTE PARA E1.** El v8.3 E6 documenta este módulo como "NO construido — único hueco real". El v0.1 B.7 lo adopta pero no define la integración técnica completa.
**Razón:** Sin esto, el 15-20% del mercado de Richmond (mayores 65+, property managers tradicionales) queda excluido. Y el coordinador no puede operar sin crear una experiencia de cliente consistente.

### B.27.1 Arquitectura integrada

El modo coordinador NO es un módulo nuevo. Es una *vista* del cotizador E1 + portal E5 + comunicaciones E6, con permisos especiales.

| Componente | Flujo normal | Flujo Coordinador |
|------------|--------------|-------------------|
| **Cotización** | Cliente web | Coordinador usa `/coordinador/cotizar` con el MISMO componente React del cotizador, pero con campo `agente_id` y `fuente: telefono`. |
| **Cuenta cliente** | SSO del cliente | Coordinador crea cuenta mínima (`email` opcional, `telefono` obligatorio, `password` auto-generado, enviado por SMS). El cliente recibe SMS: "Su cuenta Lulu está lista. Portal: [link]. Contraseña: [temp]. Cámbiela al entrar." |
| **Pago** | SetupIntent cliente | Opción A: SMS seguro (B.7.1). Opción B: e-transfer/cheque/efectivo -> marcado como `pago_pendiente` + recibo firmado digitalmente en PWA del coordinador. |
| **Portal** | Cliente accede directo | Cliente sin smartphone recibe llamada 2h post-servicio (B.7.2). Cliente con smartphone (aunque haya reservado por teléfono) usa el mismo portal. |
| **Confirmación 24h** | Email/SMS automático | IVR Twilio (B.13.1) con DTMF. Si no responde, reintento 4h después, fallback SMS, luego manual. |
| **Comunicaciones** | Catálogo central E6 | Plantilla `coordinador_notificacion` para que el coordinador sepa qué le dijo el sistema al cliente ("SMS de confirmación enviado a 604-XXX. IVR completado."). |

### B.27.2 Criterios de aceptación (cierran el hueco)
- [ ] Una reserva telefónica produce exactamente la misma `orden_servicio` que una web (mismo schema, mismo `event_id` de dominio).
- [ ] El cliente recibe cuenta automática con acceso al portal, sin pasos manuales del coordinador.
- [ ] El IVR de confirmación 24h funciona para órdenes creadas por coordinador (test con número simulado).
- [ ] El coordinador no puede ver datos de tarjeta (SetupIntent por SMS es 100% cliente-Sistema).
- [ ] El recibo firmado para pago en efectivo/e-transfer usa la misma firma digital (Documenso) que los contratos laborales.

---

## B.28 Marketplace de Turnos (ADOPTADO en E8)

**Estado:** Obligatorio en E8.
**Razón:** Reduce fricción operativa para el admin. María cubre a Pedro sin 15 mensajes de WhatsApp.

### B.28.1 Funcionalidad
- Empleado marca disponibilidad en PWA: "Puedo cubrir [zona] el [día] en franja [mañana/tarde]".
- Sistema notifica a admin: "María quiere cubrir turno de Pedro el viernes. [Aprobar] [Rechazar]".
- Si aprobado: sistema verifica compatibilidad (idioma, certificación, score) -> actualiza `equipo_empleado` y notifica a ambos.
- Anti-abuso: máximo 2 cubrimientos/semana por empleado; patrón de cubrimiento recurrente -> alerta (posible permuta no autorizada).

---

## B.29 Chat de Captura en Website (ADOPTADO en E1)

**Estado:** Obligatorio en E1.
**Razón:** Reduce fricción de cotización. No es un chatbot LLM (rechazado en C.9); es un formulario conversacional de 3 pasos.

### B.29.1 Flujo
1. Widget flotante: "¿En qué podemos ayudarle?"
2. Paso 1: "¿Cuántos baños? [1] [2] [3+]" (botones grandes, no texto libre).
3. Paso 2: "¿Mascotas? [No] [Sí, pelo corto] [Sí, pelo largo]"
4. Paso 3: "¿Cuándo lo necesita? [Esta semana] [Próxima semana] [Solo información]"
5. Resultado: Si "Solo información" -> email capturado + secuencia de nurturing. Si fecha -> redirección al cotizador con datos pre-llenados.
- **Sin IA generativa.** Es lógica de árbol con 12 ramas, hardcodeada en JSON, editable por admin en `i18n_catalogo`.

---

## B.30 Delegación Automática con Reglas (ADOPTADO en E0/E7)

**Estado:** Obligatorio en E7.
**Razón:** El Fallback de 10 min (B.2.12) decide solo. Pero algunas alertas deberían delegar a un coordinador específico, no al sistema.

### B.30.1 Reglas configurables por admin
```
SI alerta.tipo = "inventario_bajo" Y alerta.zona = "norte"
  ENTONCES asignar_a = "coordinador_maria", timeout = 30 min, fallback = "comprar_urgente"

SI alerta.tipo = "disputa_postcobro" Y alerta.monto > 200
  ENTONCES asignar_a = "admin", timeout = 10 min, fallback = "congelar_y_escalar"
```
- Panel simple: tabla con 4 columnas (Tipo, Condición, Asignado, Timeout, Fallback).
- Sin motor de reglas complejo (rechazado en C.8 del v0.1). Es una tabla `reglas_delegacion` evaluada en la Edge Function de bandeja.

---

## B.31 Proyección Financiera del Empleado (ADOPTADO en E8/E9)

**Estado:** Obligatorio en E8 (PWA) + E9 (nómina).
**Razón:** Retención. El empleado que ve su progreso financiero se queda.

### B.31.1 Funcionalidad
- En PWA, pestaña "Mi Quincena":
  - "Servicios completados: 8/10 asignados."
  - "Ganado hasta hoy: $736.00 (Day Rate + comisiones)."
  - "Proyección de quincena: $920.00 si completas los 2 restantes."
  - "Insignia 'Oro de Servicio': 42/50 servicios. Te faltan 8. Bono: +$50."
  - "Próximo pago: viernes 15 ago. Método: Direct deposit a ****4521."
- Datos: Shadow Ledger filtrado por `empleado_id`, agregado diariamente.
- **Regla:** Nunca muestra datos de otros empleados. Nunca muestra "score numérico" (solo rangos: "top 20%", "en promedio").

---

## B.32 Panel de Salud del Sistema (ADOPTADO en E0/E9)

**Estado:** Obligatorio en E0 (datos) + E9 (UI).
**Razón:** El admin necesita un "check engine" del negocio, no solo números financieros.

### B.32.1 Semáforos

| Sistema | Verde | Amarillo | Rojo | Fuente |
|---------|-------|----------|------|--------|
| **Despacho** | <90% capacidad usada | 90-98% | >98% o conflictos no resueltos | `equipo` + `orden_servicio` |
| **Inventario** | Todo > mínimo +20% | 1-2 ítems < mínimo | Stock-out inminente o PO vencida | `inventario` + `punto_logistico` |
| **Empleados** | Bench >=2 equipos | Bench 1 equipo | Bench 0 + ausencias no cubiertas | `empleado` + `equipo` |
| **Legal** | Todos los feeds <7 días | 1 feed >7 días | 1 feed >30 días o certificación vencida | `monitoreo_legal` + `empleado.certificaciones` |
| **Pagos** | Sync QBO <2h | Sync QBO 2-6h | Sync QBO >6h o divergencia >0.1% | `transaccion` + QBO adapter |
| **PWA Sync** | <5% dispositivos con sync pendiente >1h | 5-15% | >15% o sync fallido >24h | `event_log` + `gps_log` |
| **Event Bus** | Latencia <2s | Latencia 2-5s | Latencia >5s o DLQ creciendo | `event_log` + `event_dlq` |

- Panel: grid 2×4 en admin dashboard, actualizado cada 60 seg.
- Click en celda -> drill-down a detalle (lista de ítems amarillos/rojos).

---

## B.33 Programa de Referidos B2B (ADOPTADO en E10)

**Estado:** Obligatorio en E10.
**Razón:** El v8.3 tiene partners (E10.6) pero no un portal self-service para el property manager.

### B.33.1 Funcionalidad
- Portal `/partners` para property managers/agentes inmobiliarios:
  - Link de referido único con UTM.
  - Dashboard: "Clientes referidos: 5. Comisiones acumuladas: $450. Pagadas: $200. Pendientes: $250."
  - Documentos: T4A generado automáticamente (E9.4), contrato de partnership firmado digitalmente.
  - Alerta: "Su comisión de $120 está lista. Se procesará el 15 del mes."
- **Regla:** Nunca regalo personal oculto (E9.11). Todo es comisión declarada con T4A.

---

## B.34 Calculadora de Valor del Tiempo (ADOPTADO en E1)

**Estado:** Obligatorio en E1 (componente del cotizador).
**Razón:** Justifica el precio premium. El cliente no paga por limpieza; paga por tiempo recuperado.

### B.34.1 Implementación
- En cotizador, paso 3 (después de dimensiones):
  - "Basado en 1,200 ft² y 2 baños, una limpieza profunda toma ~4.5 horas."
  - "Si usted valora su tiempo en $25/hora (promedio en Richmond), eso son $112.50 de su tiempo."
  - "Nuestro servicio: $315. Usted recupera 4.5 horas para su familia, trabajo o descanso."
  - Input editable: "¿Cuánto valora su hora? [$25]" (default: $25, rango $15-$100).
- **Sin datos personales reales.** Es una proyección. No almacenamos el valor de su hora.



---

# PARTE C: MEJORAS RECHAZADAS (Nuevas — documentadas para evitar reconsideración prematura)

---

## C.9 Chatbot LLM en Website -> RECHAZADO

**Quién lo propuso:** Tendencia de mercado 2026.
**Por qué se rechaza:**
- Un chatbot LLM que "converse" con el cliente sobre limpieza genera alucinaciones ("Sí, limpiamos con amoníaco y ácido juntos" = gas cloro, riesgo legal).
- El v0.1 B.13 ya rechaza LLM semántico para telefonía por costo. En website, el riesgo es mayor porque el cliente puede leer y screenshot una respuesta incorrecta.
- La alternativa (B.29) resuelve el 90% de la captura con lógica de árbol, sin costo de API ni riesgo legal.

**Cuándo reconsiderar:** >500 chats/mes Y base de conocimiento validada por abogado + químico de seguridad. Gate: volumen + validación legal.

**Alternativa adoptada:** B.29 Chat de Captura (árbol de decisión, no LLM).

---

## C.10 Realidad Aumentada (AR) para Staging -> RECHAZADO

**Quién lo propuso:** Tendencia de visualización.
**Por qué se rechaza:**
- Requiere app nativa (no PWA), modelos 3D de cada propiedad, y hardware caro.
- El "staging fail" (B.9.3) se resuelve con foto de referencia + foto de cierre + nota. AR añade 0 valor operativo real.

**Cuándo reconsiderar:** Nunca para MVP. Quizás a 50+ equipos si hay caso B2B de property managers con 50+ unidades.

---

## C.11 Wearables para Empleados (smartwatch) -> RECHAZADO

**Quién lo propuso:** Tendencia de IoT.
**Por qué se rechaza:**
- Costo: $200+ por empleado + infraestructura de sincronización.
- El v8.3 ya tiene tablet obligatoria. Un smartwatch duplica el dispositivo sin añadir funciones que la tablet no haga (GPS del vehículo ya existe; notificaciones en tablet con vibración/haptics ya existen).
- Riesgo de privacidad: wearables trackean biometría (ritmo cardíaco, pasos) -> datos personales sensibles bajo PIPEDA.

**Cuándo reconsiderar:** Nunca en fase 1-3. Gate: problema real que la tablet no resuelva.

---

## C.12 Motor de Recomendación ML para Precios -> RECHAZADO

**Quién lo propuso:** Tendencia de "pricing inteligente".
**Por qué se rechaza:**
- El v8.3 tiene motor IF/THEN explícito (D.2) con 20 celdas. Un modelo ML es una caja negra que el admin no puede explicar ante un cliente que pregunta "¿Por qué subió mi precio?".
- Riesgo regulatorio: BC Consumer Protection Act requiere transparencia en precios. Un modelo ML que ajuste precios por "demanda percibida" puede ser visto como discriminación de precios.
- El sandbox de simulación (B.18) ya permite al admin probar reglas manualmente.

**Cuándo reconsiderar:** >5,000 órdenes/mes Y necesidad de optimización de ingreso por hora que el IF/THEN no alcance. Gate: volumen + requerimiento de precisión medible.

**Alternativa adoptada:** B.18 Simulador de Escenarios + motor IF/THEN headless.

---

## C.13 App Nativa (iOS/Android) -> RECHAZADO

**Quién lo propuso:** Tendencia de "mejor performance".
**Por qué se rechaza:**
- El v8.3 ya define PWA (E4) con Workbox, SQLite local, cámara nativa. Una app nativa requiere 2 codebases, App Store review, y no añade funciones críticas que la PWA no tenga.
- En tablet Android (obligatoria 8"+), la PWA se instala como TWA (Trusted Web Activity) y es indistinguible de nativa.
- Costo de oportunidad: 4-6 semanas de desarrollo nativo = 2 etapas completas del v8.3.

**Cuándo reconsiderar:** Necesidad de hardware específico no accesible vía web (ej: sensor de calidad del aire por Bluetooth). Gate: hardware no soportado por web.

---

# PARTE D: MAPA DE DECISIÓN ARQUITECTÓNICA ACTUALIZADO

| Decisión | Estado | Gate para reconsiderar | Costo de no esperar |
|----------|--------|------------------------|---------------------|
| Event Map ligero | ✅ Adoptado | Nunca. Es MVP. | Caos de eventos sin nombre. |
| Data Ownership Matrix | ✅ Adoptado | Nunca. Es MVP. | Corrupción de datos multi-módulo. |
| API Contracts (Zod) | ✅ Adoptado | Nunca. Es convención. | Bugs de integración silenciosos. |
| Sync Protocol PWA | ✅ Adoptado | Nunca. Es MVP. | Pérdida de evidencia en campo. |
| Pipeline Evidencia | ✅ Adoptado | Nunca. Es MVP. | Disputas sin fotos = pérdida de dinero. |
| Inventario conectado | ✅ Adoptado | Nunca. Bloqueante E3. | Equipo sin insumos = servicio fallido. |
| Canal telefónico (modo coord.) | ✅ Adoptado | Nunca. Es mercado real. | Pérdida de segmento demográfico clave. |
| Same-day / Emergencia | ✅ Adoptado | Nunca. Es regla de negocio. | Pérdida de ingresos por rigidez. |
| Gate financiero explícito | ✅ Adoptado | Nunca. Es supervivencia. | Quiebra con margen aparentemente bueno. |
| Fallback con circuit breaker | ✅ Adoptado | Nunca. Es mejora de seguridad. | Autopilot tomando decisiones erróneas en cascada. |
| IVR tradicional (MVP) | ✅ Adoptado | >100 llamadas/mes | Costo innecesario si nadie llama. |
| Centro de Transparencia | ✅ Adoptado | Nunca. Es diferenciador premium. | Cliente en "agujero  " = ansiedad = disputas. |
| Perfil público del equipo | ✅ Adoptado | Nunca. Es confianza. | Cliente reserva a ciegas = menor conversión. |
| Asistente de voz PWA | ✅ Adoptado | Nunca. Es UX de campo. | Líder friccionado con tablet = errores = retrabajo. |
| Simulador de escenarios | ✅ Adoptado | Nunca. Es herramienta admin. | Admin decide a ciegas = decisiones caras. |
| Social proof + retargeting | ✅ Adoptado | Nunca. Es marketing ligero. | CAC alto por falta de confianza. |
| Notas de cuidado | ✅ Adoptado | Nunca. Es humanización. | Servicio frío = reseñas genéricas. |
| Schema Registry | ✅ Adoptado | Nunca. Es documentación viva. | Deuda técnica de dependencias ocultas. |
| Health check unificado | ✅ Adoptado | Nunca. Es observabilidad. | Admin no sabe qué está roto hasta que es tarde. |
| Cash flow predictivo | ✅ Adoptado | Nunca. Es supervivencia. | Quiebra por sorpresa de liquidez. |
| Landing pages dinámicas | ✅ Adoptado | Nunca. Es SEO local. | CAC alto por tráfico genérico. |
| Modo Coordinador integrado | ✅ Adoptado | Nunca. Bloqueante E1. | Hueco real del v8.3 sin cerrar. |
| Marketplace de turnos | ✅ Adoptado | Nunca. Es retención. | Admin saturado de permutas manuales. |
| Chat de captura | ✅ Adoptado | Nunca. Es conversión. | Cotizaciones abandonadas sin recuperación. |
| Delegación automática | ✅ Adoptado | Nunca. Es escalabilidad admin. | Admin cuello de botella. |
| Proyección financiera empleado | ✅ Adoptado | Nunca. Es retención. | Rotación por falta de visibilidad. |
| Panel de salud del sistema | ✅ Adoptado | Nunca. Es control. | Crisis evitables no detectadas. |
| Programa referidos B2B | ✅ Adoptado | Nunca. Es canal de growth. | Partners no tienen herramienta = no refieren. |
| Calculadora valor del tiempo | ✅ Adoptado | Nunca. Es justificación de precio. | Cliente ve costo, no valor. |
| Calidad del aire | ⏸️ DIFERIDO | >20% clientes Eco × 2 meses | Costo de sensor innecesario sin demanda. |
| LLM Semántico | ❌ Rechazado | >100 llamadas/mes × 2 meses | Presupuesto destruido. |
| Workflow Engine | ❌ Rechazado | >15 equipos + workflows complejos | 2-4 semanas de desarrollo sin retorno. |
| Event Sourcing / CQRS | ❌ Rechazado | >10,000 órdenes/mes | Complejidad letal para debugging. |
| Identity separado | ❌ Rechazado | Requerimiento SAML/AD real | Reinventar Supabase Auth. |
| Permission Engine (ABAC) | ❌ Rechazado | >10 roles o permisos por atributo | Overhead para 3 roles fijos. |
| Analytics separado | ❌ Rechazado | Queries degradan producción | $50-200/mes innecesarios. |
| Reporting Engine | ❌ Rechazado | Reportes regulatorios no cubiertos | Una función genera PDFs suficiente. |
| Integration Orquestador | ❌ Rechazado | >10 integraciones activas | Capa sin valor sobre adaptadores. |
| Motor de Reglas como servicio | ❌ Rechazado | >500 evaluaciones/hora | Latencia de red por cada cotización. |
| Chatbot LLM | ❌ Rechazado | >500 chats/mes + validación legal | Riesgo legal por alucinaciones. |
| Realidad Aumentada | ❌ Rechazado | Nunca en MVP | 0 valor operativo real. |
| Wearables | ❌ Rechazado | Nunca en fase 1-3 | Duplicación de tablet + riesgo PIPEDA. |
| Motor ML de precios | ❌ Rechazado | >5,000 órdenes/mes | Caja negra, ilegalidad potencial. |
| App Nativa | ❌ Rechazado | Hardware no soportado por web | 2 codebases, 4-6 semanas perdidas. |

---

# PARTE E: CRONOGRAMA DE INTEGRACIÓN AL v8.3 (Actualizado)

| Mejora | Etapa de integración | Entregable | Bloquea siguiente etapa? |
|--------|---------------------|------------|-------------------------|
| B.1 Event Map | E0 | `events.ts` + tabla `event_log` | Sí — E1 no puede publicar eventos sin catálogo. |
| B.2 Data Ownership | E0 | Matriz firmada en repo | Sí — violación = rechazo de PR. |
| B.3 API Contracts | E0 | `packages/schemas` + tests | Sí — PR sin Zod = rechazo. |
| B.14 i18n Strategy | E0 | Config `next-intl` + tabla `i18n_catalogo` | No — pero costoso retroceder. |
| B.23 Schema Registry | E0 | Tabla `schema_registry` + grafo admin | No — pero crítico para debug. |
| B.32 Panel Salud Sistema | E0 (datos) + E9 (UI) | Grid de semáforos | No — pero es control temprano. |
| B.30 Delegación Automática | E0 (tabla) + E7 (lógica) | `reglas_delegacion` + UI | No — escalabilidad admin. |
| B.5 Pipeline Evidencia | E0 (esquema) + E4 (implementación) | Tabla + Edge Function + Storage | Sí para E5 (QC necesita fotos). |
| B.24 Consentimiento Voz | E0 (tabla) + E6 (UI) | `consentimiento_voz` append-only | No — pero legalmente necesario. |
| B.15 Centro Transparencia | E1 (esquema) + E5 (UI) | Edge Function `portal_transparencia` | No — diferenciador premium. |
| B.16 Perfil Público Equipo | E1 (datos) + E3 (UI) | `vw_equipo_stats_semanal` | No — confianza en cotización. |
| B.29 Chat de Captura | E1 | Widget árbol de decisión | No — conversión. |
| B.34 Calculadora Valor Tiempo | E1 | Componente en cotizador | No — justificación de precio. |
| B.27 Modo Coordinador | E1 (cotizador) + E6 (IVR + portal) | Flujo completo telefónico | 🚨 **Sí — cierra hueco real del v8.3.** |
| B.4 Sync Protocol | E4 | Documento técnico + implementación PWA | Sí — sin esto, E4 es inseguro. |
| B.17 Asistente de Voz | E4 | Web Speech API + comandos | No — UX de campo. |
| B.20 Notas de Cuidado | E4 (captura) + E5 (exposición) | Campo en PWA + validación NLP | No — humanización. |
| B.9 UX Campo | E4 (modo guante grueso) + E8 (energía) | CSS + checklist matutino | No — mejora calidad de vida. |
| B.6 Inventario conectado | E3 | Wireado en dispatch + PWA consumo | 🚨 Sí — bloqueante. |
| B.8 Same-day | E3 (regla en motor de despacho) | Lógica + tests de recargo | No — pero pérdida de ingresos. |
| B.18 Simulador Escenarios | E9 | Edge Function `simular_escenario` | No — toma de decisiones. |
| B.25 Cash Flow Predictivo | E2 (datos) + E9 (panel) | Proyección 30 días | No — supervivencia. |
| B.31 Proyección Empleado | E8 (PWA) + E9 (nómina) | Pestaña "Mi Quincena" | No — retención. |
| B.28 Marketplace Turnos | E8 | PWA + aprobación admin | No — fricción operativa. |
| B.7 Canal telefónico | E1 (modo coordinador) + E6 (IVR) | Botón "Reservar teléfono" + Twilio IVR | No — pero pérdida de mercado. |
| B.10 Gate financiero | Parte G (regla de gobierno) | Dashboard widget + alertas | No — pero supervivencia. |
| B.11 Audit fortalecido | E0 (tabla) + E9 (compliance) | `audit_log` + health-check legal | Sí para E9 (PIPEDA/CRA). |
| B.12 Fallback circuit breaker | E7 (consolidación excepciones) | Lógica de escalación + tests | No — mejora robustez. |
| B.13 Telefonía LLM | E10 (feature flag apagado) | Arquitectura documentada | No — activación condicional. |
| B.19 Social Proof + Retargeting | E1 (datos) + E10 (campañas) | Widget + secuencia automática | No — CAC. |
| B.26 Landing Pages Dinámicas | E10 | Next.js ISR por zona | No — SEO local. |
| B.33 Referidos B2B | E10 | Portal `/partners` | No — canal growth. |
| B.22 Gestión Predictiva Activos | E7 | Tabla `activo_equipo` + checklist PWA | No — continuidad operativa. |
| B.21 Calidad del Aire | E11 (feature flag apagado) | Arquitectura sensor + reporte | No — activación condicional. |

---

# PARTE F: GUÍA DE IMPLEMENTACIÓN POR ROL

Esta parte traduce las mejoras a *qué ve cada persona* y *por qué le importa*.

---

## F.1 Qué ve el Cliente (y por qué paga más)

| Momento | Qué ve | Por qué paga $70+/hr |
|---------|--------|----------------------|
| **Landing** | "Servicio de limpieza en [SU ZONA]" + foto real de la zona + "12 servicios esta semana aquí". | Se siente local, no genérico. |
| **Cotización** | Calculadora de valor del tiempo: "Recupere 4.5 horas por $315". Desglose completo con Hold transparente. | No ve "costo"; ve "inversión en mi tiempo". |
| **Checkout** | Badge "Garantía Lulu: si no coincide con la foto de cierre, re-servamos gratis". Perfil anónimo del equipo: "Equipo Jade — 4.9★, certificado Nivel 2, habla mandarín". | Confía antes de abrir la puerta. |
| **Día del servicio** | Portal en vivo: ETA del vehículo en mapa + zonas completadas ("Cocina ✓, Baño en curso...") + productos usados. | No está ansioso; sabe qué pasa en su casa. |
| **Post-servicio** | Galería con fotos de cierre + nota de cuidado del equipo ("Cuidamos la zona de mascotas. Recomendamos ventilar 30 min"). | Siente que cuidaron su hogar, no solo lo limpiaron. |
| **Garantía** | "Su pago se procesa hoy 7PM. ¿Algo no coincide? Repórtelo — revisamos contra la evidencia." | Sabe que tiene respaldo, no está solo. |
| **Recurrente** | "Su próximo servicio sugerido: 21 días (basado en su historial de mascotas). Reserve en 1 toque." | Le ahorra decisión; el sistema piensa por él. |

**Qué NUNCA ve:**
- Su score interno, N, HHE, score de riesgo de dirección (v8.3 B.2.3).
- Nombre individual de empleados (solo "Equipo X").
- GPS cuando el vehículo está parado >10 min.
- Productos de colores incompatibles (el poka-yoke opera en PWA, no en portal).

---

## F.2 Qué ve el Empleado (y por qué se queda)

| Momento | Qué ve | Por qué se queda |
|---------|--------|------------------|
| **Pre-jornada** | Checklist matutino: sueño, ánimo, clima, ruta. Alerta si batería <30%. | Se siente cuidado, no vigilado. |
| **Inicio** | "Equipo Jade — Hoy: 2 servicios en Richmond-Norte. Ganancia proyectada: $184 (Day Rate + comisiones)." | Ve su impacto financiero inmediato. |
| **En campo** | SOP paso a paso con poka-yoke químico (color+ícono+texto). Comando de voz: "Completar zona cocina". Timer para superficie caliente. | No necesita memorizar química; el sistema lo protege. |
| **Cierre** | "Servicio completado. Day Rate: $90. Comisiones: $12.50. Total hoy: $102.50. Insignia Oro: 42/50." | Ve progreso tangible (dinero + carrera). |
| **Post-jornada** | Chat del equipo del día (solo texto, 160 chars, 7 días). Ranking semanal: Top 3 equipos (anónimo, sin posiciones inferiores). | Siente comunidad sin toxicidad competitiva. |
| **Crisis** | Botón SOS con doble confirmación. "Aborto seguro activado. Admin contactado. Su seguridad es prioridad." | Sabe que el sistema lo respalda, no lo juzga. |
| **Apelación** | "Su apelación fue recibida. Resolución en 72h. Log inmutable." | Siente justicia procesal, no arbitrariedad. |

**Qué NUNCA ve:**
- Su score numérico individual (solo rangos: "top 20%", "en promedio").
- Score de otros empleados.
- Historial de fallos pasados.
- Datos bancarios de otros.
- @menciones, leído, reacciones (chat simple, no social media).

---

## F.3 Qué ve el Admin (y por qué duerme tranquilo)

| Momento | Qué ve | Por qué duerme tranquilo |
|---------|--------|--------------------------|
| **Mañana** | Panel de salud del sistema: 6 semáforos (Despacho, Inventario, Empleados, Legal, Pagos, PWA). Todo verde = café en paz. | Sabe que el sistema se monitorea solo. |
| **5:30 PM** | Ciclo de despacho: propuesta óptima, override drag-and-drop, publicación. Simulador: "¿Y si activo 1 equipo más mañana? Margen: +12%." | Decide con datos, no con corazonada. |
| **7:00 PM** | Batch Capture ejecutado. Shadow Ledger vs. QBO: 0.0% divergencia. Alertas: 0. | Sabe que el dinero fluye correcto. |
| **Crisis** | Bandeja unificada: "Disputa post-cobro $180 — evidencia contradictoria. Asignado a usted. Timeout: 10 min." | Nada se pierde; todo tiene dueño y timer. |
| **Delegación** | "Inventario bajo en Norte -> Coordinador María (timeout 30 min). Disputa >$200 -> Usted (timeout 10 min)." | No es cuello de botella; delega con reglas. |
| **Finanzas** | Cash flow predictivo: línea azul (caja real) por encima de fondo de emergencia los próximos 30 días. | No hay sorpresas de liquidez. |
| **Compliance** | Feed legal: Employment Standards actualizado hace 2 días. WorkSafeBC: hace 5 días. PIPEDA: hace 1 día. Todo verde. | No hay ceguera legal. |
| **Noche** | Alerta de burnout: "Usted no ha revisado QC ni reglas en 10 días. Persona de confianza notificada suavemente." | El sistema cuida que él no se queme. |

**Qué NUNCA ve:**
- Ánimo individual de empleados (solo promedio agregado del equipo).
- Sueño individual (solo alerta agregada si >30% del equipo reporta <6h).
- Datos de tarjeta de clientes (tokenizados, solo Stripe).
- Contraseñas ni credenciales crudos (hash SHA-256 en audit_log).

---

# PARTE G: GLOSARIO AMPLIADO

**Centro de Transparencia:** Portal en vivo donde el cliente ve ETA, progreso de zonas, productos usados y garantía activa durante el servicio.
**Perfil Público del Equipo:** Stats anónimas del equipo (score, certificaciones, idiomas) mostradas al cliente antes de reservar, para generar confianza.
**Nota de Cuidado:** Mensaje corto del equipo al cliente post-servicio, humanizando la entrega (ej: consejo de ventilación, observación de cuidado).
**Calculadora de Valor del Tiempo:** Componente del cotizador que traduce el precio a "horas recuperadas para el cliente", justificando la inversión premium.
**Schema Registry:** Tabla central que documenta qué módulo produce qué evento y quién lo consume, generando un grafo de dependencias visible al admin.
**Panel de Salud del Sistema:** Grid de semáforos (verde/amarillo/rojo) que muestra el estado operativo de los 7 sistemas críticos en tiempo real.
**Simulador de Escenarios:** Herramienta del admin para proyectar el impacto financiero/operativo de decisiones antes de tomarlas (sin BI ni ML).
**Modo Coordinador Integrado:** Flujo telefónico que usa el 100% del cotizador web, crea cuenta automática para el cliente, y mantiene consistencia de experiencia entre canales.
**Proyección Financiera del Empleado:** Vista en PWA donde el empleado ve su acumulado quincenal, proyección y progreso de insignias, como herramienta de retención.
**Marketplace de Turnos:** Sistema donde el empleado ofrece cubrir turnos y el admin aprueba con un toque, reemplazando el caos de WhatsApp.
**Chat de Captura:** Widget de 3 preguntas en website (árbol de decisión, no LLM) que captura leads calificados sin fricción.
**Delegación Automática:** Reglas configurables por el admin para que alertas específicas vayan a coordinadores específicos, no siempre al Fallback genérico.
**Cash Flow Predictivo:** Proyección de entradas vs. salidas a 30 días, con alerta si la caja real cruzará bajo el fondo de emergencia.
**Landing Page Dinámica:** Página de SEO local generada automáticamente por zona y tipo de servicio, con contenido real del portafolio y precios locales.
**Referidos B2B:** Portal self-service para property managers donde ven sus comisiones, clientes referidos y documentos fiscales (T4A).
**Gestión Predictiva de Activos:** Seguimiento de horas de uso de herramientas caras (vaporizador, HEPA) para mantenimiento preventivo antes del fallo en campo.
**Consentimiento de Voz:** Registro inmutable de autorización para grabación de voz en IVR y PWA, requerido por PIPEDA/CRTC.
**Calidad del Aire (DIFERIDO):** Medición de PM2.5/VOCs antes/después del servicio como diferenciador premium para clientes Eco.

---

*Anexo adoptado el 4 de Agosto, 2026. Se integra al v8.3 y al v0.1 como documento de referencia obligatoria para toda decisión de construcción.*
*Principio rector de este anexo: la arquitectura debe servir al negocio, no al revés. Cada línea de código que no resuelve un problema real de limpieza es una línea que tendremos que mantener mañana.*
