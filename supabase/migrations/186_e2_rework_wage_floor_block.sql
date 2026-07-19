-- Migración 186 — v8.3 E2 (Viaje del Dinero), bug CRÍTICO de auditoría:
-- calculatePayroll() (src/lib/payroll.ts) siempre "compensa hacia arriba"
-- hasta BC_MIN_WAGE_HOURLY cuando el rework hunde la tarifa efectiva por
-- debajo del mínimo legal, en vez de BLOQUEAR el rework y forzar
-- escalación a supervisor. El comentario original del archivo ya decía
-- "El rework excedente requiere aprobación de supervisor (no se incluye
-- automáticamente)" pero ningún endpoint hacía cumplir esa regla.
--
-- Esta migración agrega el soporte de datos que necesita la validación
-- PREVIA agregada en src/app/api/admin/qc/[orderId]/review/route.ts:
--   1. qc_reviews.rework_minutes: minutos de rework acumulados y
--      ACEPTADOS para la orden (una sola fila por orden, UNIQUE(order_id)
--      ya existente desde 010_modulo7_qc_score_tables.sql).
--   2. qc_reviews.rework_escalated_at / rework_escalation_reason: rastro
--      de que un rechazo fue bloqueado por romper el piso salarial o el
--      tope de 30 min, y quedó pendiente de escalar a supervisor.

ALTER TABLE qc_reviews
  ADD COLUMN IF NOT EXISTS rework_minutes INTEGER NOT NULL DEFAULT 0 CHECK (rework_minutes >= 0),
  ADD COLUMN IF NOT EXISTS rework_escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rework_escalation_reason TEXT;

COMMENT ON COLUMN qc_reviews.rework_minutes IS
  'Minutos de rework acumulados y aceptados para esta orden. Tope: employees.max_rework_minutes (default 30). Validado en /api/admin/qc/[orderId]/review antes de aceptar un nuevo rechazo.';
