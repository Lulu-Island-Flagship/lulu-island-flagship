# REPORTE DE AUDITORÍA E2-E5 — Dinero, Despacho, Ejecución, QC
**Fecha:** 8-9 de julio, 2026 (sesión nocturna autónoma) | **Contra:** v8.3
**Contexto:** E0 cerrada ✅, E1 auditada con fix de privacidad aplicado (ver REPORTE_E1.md).

---

## E2 — EL VIAJE DEL DINERO

| Criterio / Regla v8.3 | Estado | Evidencia |
|---|---|---|
| Seguridad de crons de dinero | ✅ PASA | Los 7 crons exigen `Bearer CRON_SECRET` (batch-capture, hold-authorize, no-show, dispatch, qbo-sync, paypal-refunds, weekly-scores). |
| Batch Capture 7:00 PM Vancouver | ✅ PASA | Cron 2,3 UTC con verificación interna de que sea exactamente 19:00 en Vancouver (DST-aware) + guard "ya corrió hoy". |
| Fórmula Hold `MAX(base, 40%)` | ✅ PASA | Tests `calculateHold` 3/3 (usa base en órdenes chicas, 40% en grandes, elige máximo). |
| Ventanas de cancelación (>72h / 24-72h / no-show) | ✅ PASA (estático) | `orders/[orderId]/cancel/route.ts` con lógica por ventana, incluida la variante PayPal (anticipo retenido + diferencia por Stripe). |
| PayPal SOLO primera reserva | ✅ PASA (estático) | `payment_option='paypal_first_time'` con gating por `services_count`; refunds automatizados (cron paypal-refunds). |
| Mínimo legal $18.25 + rework tope 30 min | ✅ PASA | Tests payroll 5/5: respeta piso al aplicar penalidad QC, capa rework en `maxReworkMinutes`, ajuste BC min wage. |
| QBO sync 2:00 AM idempotente | ✅ PASA (estático) | Cron 9,10 UTC (=2AM Vancouver); solo procesa `qbo_export_status='pending'` y marca `exported` (sin duplicados). |
| **Exclusión del batch** | ⚠️ **DESVIACIÓN** | Hoy: CUALQUIER `warranty_claim` abierto excluye la orden del cobro. v8.3 (B.2.2): la única exclusión es reclamo **con evidencia fotográfica contradictoria** — "el pago no se congela por defecto". El comportamiento actual reconstruye el incentivo perverso que v8.1 eliminó ("reclamo = no me cobran hoy"). **No lo toqué**: cambiar comportamiento de cobro sin ti despierto no es prudente, y la comparación contra fotos necesita las fotos de cierre de E4. |
| Retry 10 PM para capturas fallidas | ❌ FALTA | Spec D.10.9: falla → SMS con link → retry 10 PM → admin. No existe cron ni lógica de retry. |
| Nómina QUINCENAL (ciclo + export) | ❌ FALTA | Existe el cálculo por servicio (`payroll_entries`, correcto) pero no el ciclo quincenal ni la exportación CSV/PDF con desglose CPP/EI/WorkSafeBC (eso es E9, pero el ciclo en sí es invariante B.1). |
| Reserva de impuestos 12% / chargeback 1-3% / proyección 30 días | 🟡 PARCIAL | `chargeback_settings` y `chargeback_reserves` existen con cron en batch; reserva de impuestos y proyección de caja no encontradas. |
| Margen contribución vs. neto real separados | 🟡 PARCIAL | Contribución calculada y testeada en pricing; el margen NETO REAL (con fijos prorrateados) no existe aún (es E9/M26). |

**Preguntas E2 para ti:**
1. **Exclusión del batch (la importante):** mientras no existan fotos de cierre (E4), ¿qué regla interina quieres? (a) dejar como está — reclamo abierto excluye del cobro (protege al cliente, traiciona el diseño anti-abuso), o (b) cobrar siempre a las 7PM y resolver reclamos post-cobro con ajuste/reembolso (fiel al v8.3, pero sin la evidencia fotográfica aún). Mi lectura del v8.3 es (b), pero es política de cobro = decisión tuya.
2. ¿Agrego el retry de las 10 PM en la sesión supervisada (tocar flujo de cobro = contigo probando)?

---

## E3 — CAPACIDAD Y DESPACHO (auditoría de inventario)

**Existe:** cron dispatch-scheduler cada 15 min, API capacity, matriz admin (`admin/dispatch`), asignaciones con soft delete (E0-C2), no-show automatizado (cron 15 min con timer 30 min), vehicles + tracking API, empleado/jornada.
**No verificado aún (requiere lectura profunda o runtime):** ciclo 4:30→5:30 PM exacto, modelo 70/30 con contingencia pagada, pausa 30 min >5h, match de idioma bloqueante, Auditor de Campo (promedio móvil 5), simulación 12 PM.
**Falta con seguridad:** Auditor de Campo como rol/flujo (existe `admin/audits` pero no el despacho probabilístico 20% ni triggers), umbral equipo #6.

---

## E4 — EJECUCIÓN FÍSICA (el hueco grande)

**Existe:** páginas empleado (servicio, checklist, score, votación), API checklist, SOP checklists en datos, upsells.
**FALTA lo estructural del v8.3:**
- ❌ **PWA offline-first**: no hay manifest, ni service worker, ni Workbox, ni almacenamiento local (SQLite/IndexedDB). Las páginas de empleado son web online-only — sin red en campo, no operan. Es EL requisito central de E4.
- ❌ Poka-yoke químico (color+ícono+texto con bloqueo), cámara con cuadrícula, geocercas con T_in/T_out, protocolo de cierre externo (5 requisitos), fotos WebP con límites, protocolo Airbnb, zonas editables por admin (la tabla existe en datos; falta la propagación completa).

**Implicación de muro:** E4 es más construcción nueva que retrofit. El "checklist online" existente sirve de base de UI, pero la arquitectura offline hay que hacerla desde el diseño (no es un parche).

---

## E5 — QC Y CIERRE DE CICLO (auditoría de inventario)

**Existe (sustancial):** muro QC (`admin/qc` + review por orden), score compuesto (cron weekly-scores, peer votes, `empleado/votacion`, `empleado/appeal` — ¡el canal de apelación existe!), tickets + resolución, análisis de sentimiento (migración 015 con word boundaries), review token de un solo uso (`evaluar/[token]`), client_reviews con ventana.
**No verificado:** anti-gaming del 10%, niveles élite/estándar/observación con % de auditor, garantía relacional end-to-end (depende de fotos E4), anti-gating de reseñas (solicitud a TODOS los cierres).

---

## Arreglos hechos esta noche (además de los de E1)

1. **CI en GitHub Actions** (`.github/workflows/ci.yml`) — deuda de E0: typecheck + tests 64/64 + 2 guardas de invariantes (cero hex fuera de tokens; cero `select("*")` de cliente sobre quotes/orders). Desde ahora, nada entra a main roto.

## AGENDA PROPUESTA para cuando despiertes (en orden)

1. **Decisiones rápidas (10 min):** pregunta E2#1 (exclusión del batch), preguntas E1 (wireframes retroactivos, undo de tarifa), y este orden de agenda.
2. **Sesión supervisada de dinero (~1h, base corriendo):** blindaje DB del score (E1), retry 10PM, regla interina del batch según tu decisión, y prueba en vivo de un ciclo completo cobro/cancelación en staging.
3. **Verificación en vivo E1 (~20 min):** recorrido <90 seg, tarifa $75, margen bajo, multi-propiedad.
4. **E3: auditoría profunda** (yo solo, no necesito tu tiempo) → reporte.
5. **E4: diseño de la PWA offline** — la pieza grande faltante; te presento el plan de arquitectura antes de construir (así lo exige el v8.3 para wireframes de campo).

---

## ADENDA (misma noche) — Auditoría profunda E3 + fixes adicionales

### E3 profundo — dispatch-scheduler leído línea por línea

| Regla v8.3 | Estado | Detalle |
|---|---|---|
| Ciclo 4:30 propuesta → 5:00 corte → 5:30 publicación → 12:00 simulación | ✅ PASA | Fases implementadas con ventanas de 15 min en hora Vancouver. |
| Auto-approve al llegar a 6+ equipos | ✅ PASA | `autoApproved = availableTeams >= 6`. |
| Tabla N_min/N_max (B2C=3) | ✅ PASA | `calculateTeamRequirements` en pricing.ts con la tabla del spec. |
| Asignación por zona + trust level | ✅ PASA | Ordenamiento por misma zona y élite>estándar>observación. |
| **Match de IDIOMA en asignación** | ❌ FALTA | La query ni siquiera selecciona `employees.languages`. Invariante B.2.13: sin match no se asigna sin aprobación. **Hueco serio para el mercado de Richmond (40% chino).** |
| **Líder obligatorio por equipo** | ❌ FALTA | Propone equipos de N empleados sin exigir que uno sea supervisor/líder. "Sin líder no hay equipo" (M0). |
| Modelo 70/30 (contingencia pagada) | ❌ FALTA | No existe distinción Horario Base vs. Ventana de Contingencia. |
| Pausa 30 min tras 5h / jornada 8h-10h | ❌ FALTA | Sin validación de jornada en la propuesta. |

**Conclusión E3:** el esqueleto del ciclo diario es correcto y aprovechable; el motor de asignación necesita 4 reglas duras más (idioma, líder, 70/30, jornada). Es retrofit dirigido, no reconstrucción.

### Fixes adicionales de esta adenda (commiteados)

2. **Circularidad de reglas (E1-C7, cerrado):** nueva `detectCircularRules()` — rechaza reglas cuya condición depende de un campo derivado del precio mientras su acción modifica el precio. 4 tests nuevos (14/14 del suite de reglas pasan).
3. **Enforcement server-side al guardar reglas (E1-C7, cerrado):** el POST de pricing-rules ahora RECHAZA (400) circularidad y conflictos — antes `detectRuleConflicts` era solo un aviso en la UI y el servidor guardaba cualquier cosa.

### Actualización de la agenda: al punto 4 (E3) agregar las 4 reglas duras faltantes del motor de asignación como trabajo mío posterior a tus decisiones.
