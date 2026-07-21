-- Auditoría 2026-07-21 (INFORME_LOGICA_NEGOCIO_ROLES) — B-P5-1:
-- admin/partner-commissions confiaba orderValueCents al body sin comparar
-- contra la orden real (corregido en la ruta, este cambio es el segundo
-- candado: falta de unicidad por (partner_id, order_id) permitía calcular
-- y pagar la MISMA comisión repetidamente para la misma orden con el
-- mismo partner -- doble clic, doble submit, o dos pestañas del panel.
--
-- Índice único parcial (solo sobre filas no borradas lógicamente, ya que
-- deleted_at existe en la tabla vía prevent_hard_delete) para que un
-- segundo INSERT para el mismo (partner_id, order_id) falle con 23505 en
-- vez de crear una segunda comisión activa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_commissions_partner_order_unique
  ON partner_commissions(partner_id, order_id)
  WHERE deleted_at IS NULL AND order_id IS NOT NULL;
