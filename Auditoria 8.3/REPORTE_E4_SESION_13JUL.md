# REPORTE DE SESIÓN — Etapa E4 (Ejecución Física)
**Fecha:** 13 de julio, 2026 | **Contra:** v8.3 | **Método:** auditoría de los 8 criterios de aceptación del plan contra el código real, luego construcción de lo que faltaba

---

## Punto de partida

El `REPORTE_E4_E5.md` del 8 de julio había encontrado 4 huecos en E4 (poka-yoke sin candado real, T_out sin exigir checklist, sin PWA offline, sin compresión de fotos). Los commits posteriores (`e028c59`, `3d0608e`, `c08f29e`, `e9d612d`, `6620de1`) ya los habían corregido con solidez real. Esta sesión auditó los **8 criterios de aceptación literales de E4** contra el código actual y encontró un panorama distinto: 4 pasaban, 2 estaban parciales y 2 no tenían ni una línea de código.

## Qué se encontró y qué se construyó

| # | Criterio E4 | Estado inicial | Estado final |
|---|---|---|---|
| 1 | Jornada offline completa con sync íntegro | PARCIAL — cola de escritura offline sólida, pero cero precarga de datos (ruta/SOP/accesos) | **Construido**: `GET /api/empleado/jornada/precarga` + `src/lib/offline-day-cache.ts` (IndexedDB) descargan el día completo al iniciar jornada. Ver limitación abajo. |
| 2 | Poka-yoke químico bloquea de verdad | ✅ Ya pasaba | Sin cambios |
| 3 | Editor SOP se refleja sin tocar código | ✅ Ya pasaba | Sin cambios |
| 4 | Zona "Garaje" (peso 1.5) aparece en cotización, reparto y checklist | PARCIAL — solo llegaba a reparto y checklist, nunca a cotización | **Construido**: `is_addon_zone` + `zone_time_hours` (migración 132), motor de precio (`calculateAddonZonesCharge`), endpoint público, paso nuevo en el cotizador (`StepAddonZones`), panel admin actualizado |
| 5 | N=2, nunca Cocina+Baño con la misma persona | FALTA — `zone-reparto.ts` existía con tests pero **no estaba conectado a nada real** | **Construido**: `src/lib/zone-assignment.ts` conecta el reparto puro a órdenes reales (persistido en `assignments.zones`, migración 130), filtra el checklist del GET y lo hace cumplir en el POST y en el cierre de servicio |
| 6 | T_out bloqueado sin los 5 requisitos de cierre | ✅ Ya pasaba | Sin cambios (pero ver bug corregido abajo — afectaba directamente este criterio) |
| 7 | Checklist Airbnb distinto del residencial | FALTA — `airbnb` existía como subtipo seleccionable pero sin ninguna fila de checklist | **Construido**: migración 131, 7 zonas propias (entrada, lavandería, staging, inspección final, + agregados en habitación/baño/cocina) |
| 8 | Timer 10 min superficie caliente bloquea | ✅ Ya pasaba | Sin cambios |

## Bug crítico encontrado y corregido (fuera de la lista de 8, pero directamente relevante)

Al construir el reparto de zonas (#5) se encontró que **`orders` nunca tuvo columna `service_subtype`** — solo vive en `quotes`. Dos consultas reales la pedían igual:

- `checkClosureProtocol` (el gate de T_out, criterio #6): `order?.service_subtype` siempre era `undefined` → el checklist exigido por el cierre externo siempre resolvía a **0 zonas** → en teoría el sistema debía bloquear T_out con "No hay checklist cargado" en TODO servicio. Corregido con el join real `orders.quote_id → quotes.service_subtype`.
- `servicio/[orderId]/route.ts`: estaba asignando `quote.service_type` (el tipo interno de HHE: `regular`/`deep`/`move_in_out`/`post_construction`) a un campo llamado `serviceSubtype`, que el checklist necesita como el subtipo real (`first_time`/`regular`/`move_in_out`/`office`/`airbnb`/`post_construction`). Coincidían por casualidad solo cuando ambos strings eran `"regular"` — para servicios **First Time (Deep Cleaning)** el checklist quedaba completamente vacío en producción. Corregido.

No se pudo verificar en un entorno con Postgres real corriendo (sandbox sin Supabase local) — recomiendo que el dueño confirme con un `supabase db reset` + un servicio de prueba "First Time" que el checklist ahora carga y que T_out se comporta como antes de este fix.

## Limitación conocida y honesta

La precarga offline (#1) descarga y guarda el bundle del día, pero **las pantallas del líder (`servicio/[orderId]`, `ChecklistCierre`) todavía no tienen un fallback que lea del bundle cacheado cuando el `fetch` de red falla** — hoy siguen siendo network-first sin fallback a IndexedDB para lectura. La cola de ESCRITURA offline (checklist, fotos, cierre) ya funcionaba y sigue funcionando sin cambios. Cerrar esto por completo requiere tocar las pantallas de consumo, que quedó fuera del alcance de esta sesión por tiempo. Es el siguiente paso lógico si se quiere el criterio #1 100% cerrado.

## Verificación hecha

- 26 tests unitarios nuevos (`zone-reparto` ya existía con 12; se agregaron `zone-assignment.test.ts`, `addon-zones-pricing.test.ts`, `offline-day-cache.test.ts`), todos pasando.
- `eslint` limpio en los ~20 archivos tocados/creados.
- No se pudo correr `tsc --noEmit` completo ni la suite completa de tests por límites de tiempo del entorno de sandbox (comandos largos se cortan a los ~45s) — se verificaron los archivos tocados individualmente.
- **Pendiente de responsabilidad del dueño**: correr `supabase db reset` con las migraciones 130-132 contra una instancia real y probar el flujo E2E (jornada → checklist con N=2 → cierre) antes de producción, como exige el protocolo del documento madre (staging con datos falsos antes de cualquier cambio operativo).

## Decisiones que no estaban especificadas (para ratificar)

1. `is_addon_zone` en el editor de SOP queda en `false` por defecto — el admin debe marcarlo a mano para que una zona nueva cobre en el cotizador. Decisión: proteger el piso de margen y la transparencia de precio (B.2.4/B.2.24) en vez de cobrar automáticamente por cualquier zona nueva.
2. Con N≥2 y menos zonas que operarios, algún operario puede quedar con 0 zonas asignadas del checklist (ayuda física sin ítems propios que marcar) — comportamiento inherente al reparto por pesos del plan D.7, no un bug.
3. El checklist Airbnb no incluye todavía un campo estructurado de "spec de reabastecimiento por propiedad" ni tarifa fija por evento (D.7 lo pide) — los ítems dicen "según spec del host" como texto libre. Cerrar esto completo es trabajo de E1/E9, no de E4.
