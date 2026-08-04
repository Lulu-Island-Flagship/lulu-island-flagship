-- ============================================================
-- E0 RETROFIT (continuación) — Criterio 2: Soft Delete Universal
-- (v8.3, invariante B.2.9)
--
-- La migración 039 instaló prevent_hard_delete()/soft_delete_rewrite()
-- sobre las tablas iniciales del core, pero las tablas creadas por el
-- flujo de contratación (256-267) y el módulo de cliente (269-279)
-- quedaron sin deleted_at ni triggers de protección. Un DELETE sobre
-- cualquiera de estas tablas borra físicamente el registro, rompiendo
-- el invariante B.2.9.
--
-- Esta migración agrega:
--   1. deleted_at TIMESTAMPTZ a toda tabla sin él
--   2. prevent_hard_delete  — bloquea DELETE físico
--   3. soft_delete_rewrite  — reescribe UPDATE de deleted_at a now()
--   4. Índices parciales WHERE deleted_at IS NULL
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columna deleted_at en tablas del hiring flow + client module
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'positions',
    'candidates',
    'candidate_availability',
    'access_codes',
    'sessions',
    'documents',
    'electronic_signatures',
    'consents',
    'hr_users',
    'audit_logs',
    'communications',
    'funnel_events',
    'clients',
    'client_module_properties',
    'property_services',
    'client_consents',
    'client_payment_methods',
    'client_invoices',
    'client_invoice_line_items',
    'client_payments',
    'candidate_banking_info'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', t);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. prevent_hard_delete: DELETE físico prohibido (bloqueo duro)
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'positions',
    'candidates',
    'candidate_availability',
    'access_codes',
    'sessions',
    'documents',
    'electronic_signatures',
    'consents',
    'hr_users',
    'audit_logs',
    'communications',
    'funnel_events',
    'clients',
    'client_module_properties',
    'property_services',
    'client_consents',
    'client_payment_methods',
    'client_invoices',
    'client_invoice_line_items',
    'client_payments',
    'candidate_banking_info'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_prevent_delete ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete()', t);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. soft_delete_rewrite: UPDATE de deleted_at forzado a now()
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'positions',
    'candidates',
    'candidate_availability',
    'access_codes',
    'sessions',
    'documents',
    'electronic_signatures',
    'consents',
    'hr_users',
    'audit_logs',
    'communications',
    'funnel_events',
    'clients',
    'client_module_properties',
    'property_services',
    'client_consents',
    'client_payment_methods',
    'client_invoices',
    'client_invoice_line_items',
    'client_payments',
    'candidate_banking_info'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_soft_delete ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_soft_delete BEFORE UPDATE OF deleted_at ON %I FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) EXECUTE FUNCTION soft_delete_rewrite()', t);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4. Índices parciales para consultas que filtran por no-eliminado
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'positions',
    'candidates',
    'candidate_availability',
    'access_codes',
    'sessions',
    'documents',
    'electronic_signatures',
    'consents',
    'hr_users',
    'audit_logs',
    'communications',
    'funnel_events',
    'clients',
    'client_module_properties',
    'property_services',
    'client_consents',
    'client_payment_methods',
    'client_invoices',
    'client_invoice_line_items',
    'client_payments',
    'candidate_banking_info'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (deleted_at) WHERE deleted_at IS NULL',
        'idx_' || t || '_not_deleted', t);
    END IF;
  END LOOP;
END $$;
