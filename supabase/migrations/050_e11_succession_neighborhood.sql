-- Migración 050 — v8.3 E11: Modo Sucesión, backup de conocimiento operativo,
-- y módulo de vecindario.
--
-- IMPORTANTE (igual que E7): trusted_successors se crea VACÍA a propósito.
-- Los nombres, contactos y documentos legales reales de las personas de
-- confianza de Aeon deben cargarse desde el admin, no inventarse aquí.

-- ============================================================
-- 1. Personas de confianza (Modo Sucesión)
-- ============================================================
CREATE TABLE IF NOT EXISTS trusted_successors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  relationship TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  granted_access_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE trusted_successors ENABLE ROW LEVEL SECURITY;
-- Solo owner_admin ve/administra esta tabla (contiene datos personales de
-- personas de confianza, no es operativo del dia a dia).
DROP POLICY IF EXISTS "Owner manages trusted successors" ON trusted_successors;
CREATE POLICY "Owner manages trusted successors" ON trusted_successors
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON trusted_successors;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON trusted_successors
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Estado de sucesion (fila unica, tipo singleton de configuracion)
CREATE TABLE IF NOT EXISTS succession_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'normal'
    CHECK (status IN ('normal', 'burnout_alert', 'succession_alert', 'auto_activate', 'manually_activated')),
  activated_at TIMESTAMPTZ,
  activated_reason TEXT,
  activated_by UUID REFERENCES employees(id),
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE succession_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner reads succession status" ON succession_status;
CREATE POLICY "Owner reads succession status" ON succession_status
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));
DROP POLICY IF EXISTS "Owner manages succession status" ON succession_status;
CREATE POLICY "Owner manages succession status" ON succession_status
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP TRIGGER IF EXISTS trg_prevent_delete ON succession_status;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON succession_status
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Salvaguarda dura (D.11.1: "sin poder de... eliminar al dueño"): bloquea
-- quitar el ULTIMO owner_admin activo del sistema, sin importar quien
-- ejecute el UPDATE/DELETE (ni siquiera otro owner_admin puede dejar el
-- sistema sin ningun owner_admin).
CREATE OR REPLACE FUNCTION prevent_removing_last_owner_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining_owners INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner_admin' THEN
      SELECT COUNT(*) INTO v_remaining_owners
      FROM admin_roles
      WHERE role = 'owner_admin' AND id <> OLD.id;
      IF v_remaining_owners = 0 THEN
        RAISE EXCEPTION 'No se puede eliminar el ultimo owner_admin del sistema (v8.3 E11: proteccion de sucesion)';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role = 'owner_admin' AND NEW.role <> 'owner_admin' THEN
    SELECT COUNT(*) INTO v_remaining_owners
    FROM admin_roles
    WHERE role = 'owner_admin' AND id <> OLD.id;
    IF v_remaining_owners = 0 THEN
      RAISE EXCEPTION 'No se puede degradar el ultimo owner_admin del sistema (v8.3 E11: proteccion de sucesion)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_removing_last_owner ON admin_roles;
CREATE TRIGGER trg_prevent_removing_last_owner
  BEFORE UPDATE OR DELETE ON admin_roles
  FOR EACH ROW EXECUTE FUNCTION prevent_removing_last_owner_admin();

COMMENT ON FUNCTION prevent_removing_last_owner_admin() IS
  'v8.3 E11: ni siquiera un owner_admin puede dejar el sistema sin ningun owner_admin. Protege contra "eliminar al dueño" (D.11.1).';

-- ============================================================
-- 2. Backup de conocimiento operativo — notas por entidad
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('employee', 'client_property', 'client_profile', 'vehicle')),
  entity_id UUID NOT NULL,
  note TEXT NOT NULL,
  -- Contexto donde debe sugerirse esta nota (ej: "dispatch", "quote", "checkin")
  suggest_context TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_entity_notes_lookup ON entity_notes(entity_type, entity_id);

ALTER TABLE entity_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage entity notes" ON entity_notes;
CREATE POLICY "Supervisors manage entity notes" ON entity_notes
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON entity_notes;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON entity_notes
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 3. Vecindario (D.11.5)
-- ============================================================
CREATE TABLE IF NOT EXISTS neighborhood_complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_property_id UUID REFERENCES client_properties(id),
  order_id UUID REFERENCES orders(id),
  description TEXT NOT NULL,
  reported_by TEXT, -- concierge / vecino / cliente
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE neighborhood_complaints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage neighborhood complaints" ON neighborhood_complaints;
CREATE POLICY "Supervisors manage neighborhood complaints" ON neighborhood_complaints
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON neighborhood_complaints;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON neighborhood_complaints
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Direcciones marcadas como "sensibles" tras una queja (propagacion simple:
-- solo un flag en client_properties, sin duplicar logica de riesgo de E7).
ALTER TABLE client_properties
  ADD COLUMN IF NOT EXISTS neighborhood_sensitive BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS neighbor_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  source_property_id UUID REFERENCES client_properties(id),
  contacted_at TIMESTAMPTZ,
  converted_to_quote_id UUID REFERENCES quotes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE neighbor_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage neighbor leads" ON neighbor_leads;
CREATE POLICY "Supervisors manage neighbor leads" ON neighbor_leads
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON neighbor_leads;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON neighbor_leads
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE trusted_successors IS 'v8.3 E11: estructura vacia a proposito. Cargar personas de confianza reales desde el admin.';
