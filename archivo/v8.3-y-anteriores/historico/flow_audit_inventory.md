# Inventario maestro de flujos — Lulu Island Flagship

Lista completa de flujos del sistema, sacada directamente de la estructura real
de `src/app` (no es una selección subjetiva). Se audita uno a la vez, marcando
`[x]` cuando quede revisado. Cuando todas las filas estén marcadas, la
auditoría por flujo está completa — sin adivinar qué faltaba.

Cada flujo lista las rutas/archivos que lo componen, para que sepas
exactamente qué subir a Gemini cuando le toque su turno.

---

## A. Flujos de Cliente (público)

- [ ] **A1 — Cotización (quote):** `src/app/[locale]/cotizador/*`, `src/app/api/quote/preview`, `src/app/api/quote/recalculate`
- [ ] **A2 — Reserva y pago:** `src/app/[locale]/reserva/[quoteId]/*`, `src/app/api/stripe/setup-intent`, `src/app/api/stripe/confirm`, `src/app/api/stripe/webhook`
- [ ] **A3 — Confirmación:** `src/app/[locale]/confirmacion/*`
- [ ] **A4 — Cuenta del cliente:** `src/app/[locale]/cuenta/*`, `src/app/[locale]/cuenta/propiedades/*`, `src/app/api/client/properties`
- [ ] **A5 — Evaluación/reseña del cliente:** `src/app/[locale]/evaluar/[token]/*`, `src/app/api/client/review`
- [ ] **A6 — Cancelación de orden:** `src/app/api/orders/[orderId]/cancel`

## B. Flujos de Empleado

- [ ] **B1 — Login/sesión empleado:** (verificar mecanismo — mismo Supabase Auth que admin, o distinto)
- [ ] **B2 — Jornada y checkin:** `src/app/api/empleado/checkin`, `src/app/api/empleado/jornada`, `src/app/api/empleado/readiness`
- [ ] **B3 — Servicio en curso:** `src/app/[locale]/empleado/servicio/[orderId]/*`, `src/app/api/empleado/servicio`, `src/app/api/empleado/servicio/[orderId]`, `src/app/api/empleado/servicios`
- [ ] **B4 — Cierre de servicio:** `src/app/api/empleado/cierre`
- [ ] **B5 — Checklist de limpieza:** `src/app/api/empleado/checklist`
- [ ] **B6 — Llaves:** `src/app/[locale]/empleado/llaves/*`, `src/app/[locale]/empleado/llaves/[orderId]/*`, `src/app/api/empleado/llaves`
- [ ] **B7 — Paños/insumos:** `src/app/[locale]/empleado/panos/*`, `src/app/api/empleado/panos`
- [ ] **B8 — Near-miss (casi-accidentes):** `src/app/api/empleado/near-miss`
- [ ] **B9 — Safety abort:** `src/app/api/empleado/safety-abort`, `src/app/api/empleado/safety-abort/[id]`
- [ ] **B10 — Alerta química/wellbeing:** `src/app/api/empleado/chemical-alert`
- [ ] **B11 — Votación:** `src/app/[locale]/empleado/votacion/*`, `src/app/api/empleado/votacion`
- [ ] **B12 — Score y ranking:** `src/app/[locale]/empleado/score/*`, `src/app/api/empleado/score`
- [ ] **B13 — Apelación:** `src/app/api/empleado/appeal`
- [ ] **B14 — Upsells (venta adicional en sitio):** `src/app/api/empleado/upsells`
- [ ] **B15 — Tracking de vehículo:** `src/app/api/empleado/vehicle-tracking`

## C. Flujos de Admin — Autenticación y permisos (cross-cutting)

- [x] **C1 — Login admin (Google OAuth + email OTP):** `src/components/admin/AdminLoginScreen.tsx`, `src/app/auth/callback/route.ts`, `src/app/auth/signout` — **ya auditado hoy en vivo, bug de redirect ya arreglado (migración 125 + config.toml)**
- [ ] **C2 — Gate de permisos (RBAC):** `src/app/[locale]/admin/layout.tsx`, `src/lib/admin.ts`, `src/lib/admin-rbac.ts`, `supabase/migrations/125_e0_grants_base_roles.sql`
- [ ] **C3 — Auditoría de acciones (admin_action_logs):** lógica de logging dentro de `requireAdminRole()` en `src/lib/admin.ts`

## D. Flujos de Admin — Operación diaria

- [ ] **D1 — Gestión de servicios/órdenes:** `src/app/[locale]/admin/servicios/*`, `src/app/[locale]/admin/servicios/[orderId]/*`, `src/app/api/admin/servicios`, `src/app/api/admin/dispatch`
- [ ] **D2 — Gestión de empleados:** `src/app/[locale]/admin/empleados/*`, `src/app/api/admin/empleados`
- [ ] **D3 — Gestión de vehículos:** `src/app/[locale]/admin/vehicles/*`, `src/app/api/admin/vehicles`, `src/app/api/admin/vehicles/[id]`
- [ ] **D4 — Revisión de upsells:** `src/app/[locale]/admin/upsells/*`, `src/app/api/admin/upsells`, `src/app/api/admin/upsells/[id]`, `src/app/api/admin/upsells/[id]/review`
- [ ] **D5 — Checklists (config):** `src/app/[locale]/admin/checklists/*`, `src/app/api/admin/checklists/*`, `src/app/api/admin/checklist`
- [ ] **D6 — QC (control de calidad):** `src/app/[locale]/admin/qc/*`, `src/app/api/admin/qc/*`
- [ ] **D7 — Auditorías internas:** `src/app/[locale]/admin/audits/*`, `src/app/api/admin/audits`
- [ ] **D8 — Tickets de soporte:** `src/app/[locale]/admin/tickets/*`, `src/app/api/admin/tickets/*`
- [ ] **D9 — Reglas de precios:** `src/app/[locale]/admin/pricing-rules/*`, `src/app/[locale]/admin/pricing-rules/sandbox/*`, `src/app/api/admin/pricing-rules/*`
- [ ] **D10 — Configuración de precios:** `src/app/[locale]/admin/pricing-settings/*`, `src/app/api/admin/pricing-settings`
- [ ] **D11 — Inventario y compras:** `src/app/[locale]/admin/inventario/*`, `src/app/api/admin/inventory-items`, `src/app/api/admin/purchase-orders/*`, `src/app/api/admin/suppliers`
- [ ] **D12 — Near-misses (vista admin):** `src/app/[locale]/admin/near-misses/*`, `src/app/api/admin/near-misses`
- [ ] **D13 — Evaluación de riesgo:** `src/app/[locale]/admin/riesgo/*`, `src/app/api/admin/risk-assessments`
- [ ] **D14 — SOS/safety aborts (vista admin):** `src/app/[locale]/admin/sos/*`, `src/app/api/admin/safety-aborts/*`
- [ ] **D15 — Ranking de equipo:** `src/app/[locale]/admin/team-ranking/*`, `src/app/api/admin/team-ranking`
- [ ] **D16 — Competencia (scraping):** `src/app/[locale]/admin/competencia/*`, `src/app/api/admin/competencia`
- [ ] **D17 — Marketing:** `src/app/[locale]/admin/marketing/*`, `src/app/api/admin/marketing`
- [ ] **D18 — Contabilidad (QBO):** `src/app/[locale]/admin/contabilidad/*`, `src/app/api/admin/accounting`
- [ ] **D19 — Ajustes HHE:** `src/app/[locale]/admin/ajustes-hhe/*`, `src/app/api/admin/hhe-adjustments`, `src/app/api/admin/hhe-settings`
- [ ] **D20 — Recuperación de desastres:** `src/app/[locale]/admin/recuperacion-desastres/*`, `src/app/api/admin/dr-drill`
- [ ] **D21 — Historial de configuración:** `src/app/[locale]/admin/config-history/*`, `src/app/api/admin/config-history`
- [ ] **D22 — Feature flags:** `src/app/[locale]/admin/feature-flags/*`, `src/app/api/admin/feature-flags`
- [ ] **D23 — Comunicaciones (plantillas):** `src/app/[locale]/admin/comunicaciones/*`, `src/app/api/admin/communication-templates`
- [ ] **D24 — Contingencia:** `src/app/[locale]/admin/contingencia/*`
- [ ] **D25 — Revisión de cotizaciones:** `src/app/[locale]/admin/quotes-review/*`, `src/app/api/admin/quotes/*`
- [ ] **D26 — Reclamos de garantía:** `src/app/[locale]/admin/warranty-claims/*`, `src/app/api/admin/warranty-claims/*`
- [ ] **D27 — Regalos de retención:** `src/app/api/admin/retention-gifts`
- [ ] **D28 — Wellbeing (vista admin):** `src/app/api/admin/wellbeing`
- [ ] **D29 — Parámetros económicos:** `src/app/api/admin/economic-params`
- [ ] **D30 — Capacidad operativa:** `src/app/api/capacity`
- [ ] **D31 — Exportaciones (nómina, datos):** `src/app/api/admin/export`, `src/app/api/admin/payroll-export`

## E. Flujos de sistema — Cron jobs

- [ ] **E1 — Captura diferida de pagos:** `src/app/api/cron/batch-capture`, `src/app/api/cron/batch-capture-retry`
- [ ] **E2 — Monitor de exposición de caja:** `src/app/api/cron/cash-exposure-monitor`
- [ ] **E3 — Scraping de competencia:** `src/app/api/cron/competitor-scrape`
- [ ] **E4 — Ajuste de contrato por IPC:** `src/app/api/cron/contract-ipc-adjustment`
- [ ] **E5 — Scheduler de despacho:** `src/app/api/cron/dispatch-scheduler`
- [ ] **E6 — Autorización de holds:** `src/app/api/cron/hold-authorize`
- [ ] **E7 — No-shows:** `src/app/api/cron/no-show`
- [ ] **E8 — Reembolsos PayPal:** `src/app/api/cron/paypal-refunds`
- [ ] **E9 — Sincronización QBO:** `src/app/api/cron/qbo-sync`
- [ ] **E10 — Escalamiento de safety abort:** `src/app/api/cron/safety-abort-escalation`
- [ ] **E11 — Scores semanales:** `src/app/api/cron/weekly-scores`
- [ ] **E12 — Reasignación por wellbeing/químicos:** `src/app/api/cron/wellbeing-chemical-reassign`

## F. Webhooks e integraciones externas

- [ ] **F1 — Webhook de Stripe:** `src/app/api/stripe/webhook`
- [ ] **F2 — Webhook de telefonía:** `src/app/api/telephony/webhook`
- [ ] **F3 — Evento de analítica:** `src/app/api/analytics/event`
- [ ] **F4 — BC Assessment (avalúo catastral):** `src/app/api/bc-assessment`

---

## Cómo se usa esto

1. Cuando le toque el turno a un flujo, reúne los archivos listados en su fila
   y súbelos juntos a Gemini (mismo chat, mismo contexto) usando el prompt de
   `flow_audit_prompt_template.md`.
2. Al terminar, marca la fila con `[x]` en este archivo y guarda el resultado
   de Gemini como `audit-<codigo>.md` (ej. `audit-D1.md`).
3. Cuando todas las filas de las secciones A–F estén marcadas, la auditoría
   por flujo está completa — no antes.

No hay orden obligatorio de prioridad aquí a propósito: decides tú el orden
de ataque, pero la lista no se acorta.
