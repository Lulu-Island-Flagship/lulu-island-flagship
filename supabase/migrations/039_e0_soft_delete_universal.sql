-- ============================================================
-- E0 RETROFIT — Criterio 2: Soft Delete Universal (v8.3, invariante B.2.9)
-- Clasificación aprobada por el dueño (2026-07-08):
--   A) NEGOCIO: deleted_at + DELETE bloqueado (o reescrito a soft delete)
--   B) INMUTABLES/EVIDENCIA: sin deleted_at, DELETE bloqueado (registro permanente)
--   C) EFÍMERAS TÉCNICAS: rate_limits, analytics_events — DELETE real permitido
-- Nota de diseño: donde la tabla ya tiene is_active/status, ese campo sigue
-- siendo el "estado" operativo; deleted_at IS NULL define existencia lógica.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columna deleted_at en TODAS las tablas de negocio (grupo A)
-- ------------------------------------------------------------
ALTER TABLE profiles               ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE client_profiles        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE client_properties      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE client_wallets         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE employees              ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE vehicles               ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE quotes                 ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE orders                 ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE assignments            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE service_contracts      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE contract_instances     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE service_upsells        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE sop_checklists         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE service_checklist_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE qc_reviews             ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tickets_disputas       ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE warranty_claims        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE field_audits           ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE pricing_rules          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE feature_flags          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE payroll_entries        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE chargeback_reserves    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE client_reviews         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE capacity_slots         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Índices parciales solo para las 3 tablas con reescritura (acumularán filas soft-deleted)
CREATE INDEX IF NOT EXISTS idx_assignments_not_deleted   ON assignments(order_id)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sop_checklists_not_deleted ON sop_checklists(service_subtype) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pricing_rules_not_deleted ON pricing_rules(id)          WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- 2. Función: DELETE reescrito a soft delete (para flujos existentes de la app)
--    Aplica a: assignments, sop_checklists, pricing_rules
--    El .delete() del código existente sigue "funcionando", pero nada se destruye.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_rewrite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE format(
    'UPDATE %I.%I SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
  ) USING OLD.id;
  RETURN NULL; -- suprime el DELETE físico
END;
$$;

DROP TRIGGER IF EXISTS trg_soft_delete ON assignments;
CREATE TRIGGER trg_soft_delete BEFORE DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION soft_delete_rewrite();

DROP TRIGGER IF EXISTS trg_soft_delete ON sop_checklists;
CREATE TRIGGER trg_soft_delete BEFORE DELETE ON sop_checklists
  FOR EACH ROW EXECUTE FUNCTION soft_delete_rewrite();

DROP TRIGGER IF EXISTS trg_soft_delete ON pricing_rules;
CREATE TRIGGER trg_soft_delete BEFORE DELETE ON pricing_rules
  FOR EACH ROW EXECUTE FUNCTION soft_delete_rewrite();

-- ------------------------------------------------------------
-- 3. Función: DELETE prohibido (negocio sin flujo de borrado + inmutables)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'DELETE físico prohibido en % (invariante v8.3 B.2.9). Use soft delete: UPDATE ... SET deleted_at = now()', TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$;

-- Grupo A sin flujo de borrado en la app: DELETE debe FALLAR
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','client_profiles','client_properties','client_wallets',
    'employees','vehicles','quotes','orders','service_contracts',
    'contract_instances','service_upsells','service_checklist_items',
    'qc_reviews','tickets_disputas','warranty_claims','field_audits',
    'feature_flags','payroll_entries','chargeback_reserves','client_reviews',
    'capacity_slots'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_prevent_delete ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete()', t);
  END LOOP;
END $$;

-- Grupo B: registro inmutable/evidencia — DELETE prohibido, sin deleted_at
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pricing_settings_audit_logs','rule_audit_logs','stripe_webhook_events',
    'wallet_transactions','warranty_photo_evidence','vehicle_tracking',
    'service_logs','no_show_logs','dispatch_runs','peer_votes',
    'employee_scores','sentiment_alerts','qbo_exports','qbo_export_lines',
    'pricing_settings','payroll_settings','chargeback_settings','hhe_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_prevent_delete ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete()', t);
  END LOOP;
END $$;

-- Grupo C (rate_limits, analytics_events): sin restricción — limpieza técnica permitida.

COMMENT ON FUNCTION soft_delete_rewrite() IS 'v8.3 E0-C2: convierte DELETE en soft delete (deleted_at=now). Nada se destruye.';
COMMENT ON FUNCTION prevent_hard_delete() IS 'v8.3 E0-C2: bloquea DELETE físico en tablas de negocio e inmutables.';
