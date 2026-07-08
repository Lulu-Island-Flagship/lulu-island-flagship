# REPORTE DE AUDITORÍA E1 — Cotizador y Reserva
**Fecha:** 8 de julio, 2026 (sesión nocturna autónoma) | **Contra:** v8.3, criterios de aceptación E1
**Regla aplicada:** sin evidencia no hay PASA. Solo se corrigió lo que el v8.3 define sin ambigüedad.

## Tabla de criterios

| # | Criterio E1 | Estado | Evidencia / Detalle |
|---|---|---|---|
| 1 | Reserva completa (SSO→cotización→clickwrap→SetupIntent) <90 seg | 🔵 NO VERIFICABLE ESTÁTICO | Todas las piezas existen: Google OAuth + Apple + email/SMS (`AuthModal.tsx`), flujo 5 pasos, clickwrap, SetupIntent (`stripe/setup-intent`). El cronómetro requiere recorrido en vivo — hacerlo juntos con la app corriendo. |
| 2 | Tarifa $70→$75 recalcula 20 celdas + snapshot con undo | 🟡 PARCIAL | Recalculo ✓ (tests `getBasePriceTable` 64/64 pasan; `pricing_settings` con tarifa como parámetro único). Snapshot ✓ vía filas versionadas + audit log. **Falta:** el "Deshacer" de E0-C6 no cubre el flujo de tarifa porque pricing usa INSERT versionado, no UPDATE — el trigger no dispara. Decisión menor pendiente (ver preguntas). |
| 3 | Cotización con margen <15% retenida antes de confirmarse | ✅ PASA (estático) | `quote/route.ts` marca `admin_review_required`; la página de reserva BLOQUEA la reserva (línea 97); workflow de revisión admin en migración 032 + rutas `admin/quotes`. |
| 4 | Hold estimado en la misma pantalla + texto "no es un cargo" | ✅ PASA | `PriceBreakdown.tsx:144-152`: "A temporary authorization (not a charge)…" junto al precio. |
| 5 | El cliente no puede ver su score por ninguna vía | 🟡 CORREGIDO APP / PENDIENTE DB | **Estaba VIOLADO:** `select("*")` exponía `client_score`, `estimated_labor_cost`, `estimated_margin_contribution` y el motivo de revisión (¡el margen interno!) al navegador del cliente, y `PriceBreakdown` mostraba el motivo en pantalla. **Corregido esta noche** (ver "Arreglos"). Queda el blindaje definitivo a nivel de base de datos — requiere sesión supervisada (ver preguntas). |
| 6 | 3 consentimientos separados con versión+timestamp+IP; sin fotos → auditoría 100% | ✅ PASA (estático) | `quote/route.ts:494-505`: consent_tc/pipa/marketing/photo + versiones + IP + accepted_at; `pipa_alt_requires_audit=true` cuando no consiente fotos. |
| 7 | Reglas IF/THEN: conflictos rechazados, tope +25% | 🟡 PARCIAL | Conflictos ✓ y tope +25% ✓ (tests `detectRuleConflicts` y `caps cumulative surcharge` pasan). **Falta evidencia de prevención de circularidad** específicamente — revisar si `rules.ts` la cubre o agregarla. |
| 8 | Wireframes de editor de reglas y sandbox aprobados ANTES de construir | ❌ NO CUMPLE (proceso) | Las pantallas `admin/pricing-rules` y `simulate` YA existen y nunca pasaron por tu aprobación de wireframe. El código puede estar bien, pero el proceso se violó. Decisión tuya (ver preguntas). |
| 9 | Cuenta con 3 propiedades cotiza sin duplicar cuenta | ✅ PASA (estático) | Tabla `client_properties` + API `client/properties` operativas. Test E2E en vivo pendiente. |

## Arreglos hechos esta noche (commiteados)

1. **Fuga del score y economía interna al cliente (violación del invariante B.2.3)** — el hallazgo serio de la noche:
   - `src/lib/client-visible-columns.ts` (NUEVO): listas explícitas de columnas visibles al cliente para `quotes` y `orders` — única fuente, prohibido `select("*")` en contexto de usuario.
   - Corregidos: página de reserva, página de confirmación (quotes y orders), GET `/api/quote`, y el `.select()` del INSERT del cotizador.
   - La respuesta del POST ya no envía `adminReviewReason` (filtraba "margen 12% < piso 15%" al navegador); `PriceBreakdown` muestra ahora un mensaje genérico digno del posicionamiento premium.
   - Typecheck: 0 errores.

## Preguntas para ti (en orden de importancia)

1. **Blindaje DB del score (C5):** el arreglo de esta noche elimina la exposición real en la app, pero un usuario técnico aún podría consultar su columna `client_score` directo contra la API de Supabase (RLS da acceso a la fila completa). El cierre definitivo son GRANTs por columna — toca ~70 puntos de lectura incluyendo los flujos de Stripe y los cron de cobro, así que debe hacerse contigo despierto y la base corriendo para probar pagos. ¿Agendamos esa sesión?
2. **Pantallas sin wireframe (C8):** `pricing-rules` y `simulate` existen sin tu aprobación. Opciones: (a) te muestro capturas y las apruebas/ajustas retroactivamente (barato), o (b) exiges wireframe formal y se rehacen. Recomiendo (a).
3. **Undo de tarifa (C2):** ¿te basta el historial versionado de tarifas (volver a la tarifa anterior = crear nueva versión con el valor viejo, ya posible), o quieres botón "Deshacer" explícito también ahí?
4. **Circularidad de reglas (C7):** falta el test/validación específica. Lo agrego en la próxima sesión salvo que digas lo contrario.

## Verificación en vivo pendiente (contigo, ~20 min, con `npm run dev` + base local)
Recorrido cotización→reserva cronometrado (<90 seg) | cambiar tarifa a $75 y ver las 20 celdas | cotizar con margen bajo y ver el bloqueo | cuenta con 2+ propiedades.
