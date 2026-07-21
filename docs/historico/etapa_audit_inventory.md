# Inventario maestro — Auditoría de cumplimiento vs. v8.3

Fuente única de verdad: `Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md` (v8.2
quedó reemplazado formalmente, ver Parte G, línea 707 del propio v8.3 — se
consulta solo como contexto histórico, nunca como criterio de aceptación).

Cada etapa E0–E11 ya trae su propio checklist real de "Criterios de
aceptación" (casillas `- [ ]` literales en el documento). Esta auditoría NO
reinventa esos criterios — los usa tal cual, y determina si el código
cumple, cumple parcial, no existe, o diverge.

Estado: **cumplido** / **parcial** / **no iniciado** / **diverge** / sin auditar

---

| Etapa | Cubre | Líneas en v8.3 | Estado | Notas |
|---|---|---|---|---|
| E0 — Fundación técnica | Infra, RBAC, feature flags, tokens de diseño | 348–376 | parcial | Login+RBAC ya auditado en vivo hoy (bug de GRANTs, ya arreglado). Falta verificar: CI/CD, feature flags panel, snapshot/undo, Autopilot/Manual, adaptadores anti-corrupción |
| E1 — Cotizador y reserva | SSO, motor de precios, consentimientos, portal | 378–420 | sin auditar | |
| E2 — El viaje del dinero | Hold, PayPal, Batch Capture, garantía, QBO, nómina | 423–449 | sin auditar | Alto riesgo si hay dinero real involucrado — auditar antes de conectar claves live |
| E3 — Capacidad y despacho | Equipos, 70/30, auto-asignación, fallback, tracking | 452–476 | sin auditar | |
| E4 — Ejecución física (PWA) | PWA offline, SOP, código químico, manual | 479–509 | sin auditar | |
| E5 — QC, score y cierre de ciclo | Muro QC, score, garantía operando, reseñas | 512–540 | sin auditar | |
| E6 — Comunicaciones e inclusión | Catálogo de eventos, telefonía, throttling, WCAG | 543–562 | sin auditar | |
| E7 — Excepciones, inventario, riesgo | 10 excepciones, inventario, vehículos, llaves | 565–586 | sin auditar | |
| E8 — Empleado: preparación y comunidad | Pre-jornada, bienestar, gamificación, carrera | 589–616 | sin auditar | |
| E9 — Contabilidad, nómina, compliance | Panel contable, nómina, compliance legal, regalos | 619–645 | sin auditar | |
| E10 — Marketing e inteligencia competitiva | Posicionamiento, atribución, SEO, A/B | 648–673 | sin auditar | |
| E11 — Continuidad, vecindario, escala | Sucesión, disaster recovery, sostenibilidad | 676–695 | sin auditar | |

---

## Cómo se usa

1. Elige una etapa (no hay orden obligatorio, pero E0→E2 tiene sentido si vas
   a tocar dinero real pronto).
2. Copia el texto literal de "### Criterios de aceptación EX" de esa etapa
   directo del archivo `v8.3_PLAN_DE_CONSTRUCCION.md` (líneas indicadas
   arriba) y pégalo en el prompt junto con el código relevante — usa
   `flow_audit_inventory.md` para saber qué archivos de código corresponden
   a esa área (ej. E2 se cruza con A2, D-varios de dinero; E7 con B6/B8/B9,
   D11-D14, etc. — no es 1:1 exacto porque v8.3 agrupa distinto que la
   estructura de carpetas real).
3. Usa `etapa_audit_prompt_template.md` para el prompt exacto.
4. Actualiza la columna Estado aquí cuando tengas el resultado de Gemini.
5. Auditoría de cumplimiento completa cuando las 12 filas dejen de decir
   "sin auditar".
