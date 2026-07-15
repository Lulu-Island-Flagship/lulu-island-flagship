-- Migración 148 — v8.3 E11 (D.11.5): reglas de vecindario. La lógica pura
-- (src/lib/neighborhood.ts: getNoiseWindow, isWithinNoiseWindow,
-- shouldNotifyConcierge, getAccessProtocol — 100% testeada) existía sin
-- ninguna tabla ni ruta que la usara.

ALTER TABLE client_properties
  ADD COLUMN IF NOT EXISTS zone_type TEXT DEFAULT 'residential'
    CHECK (zone_type IN ('condo_55plus', 'airbnb', 'residential', 'commercial')),
  ADD COLUMN IF NOT EXISTS concierge_notify_preference TEXT DEFAULT 'never'
    CHECK (concierge_notify_preference IN ('always', 'only_if_absent', 'never')),
  ADD COLUMN IF NOT EXISTS building_access_type TEXT
    CHECK (building_access_type IS NULL OR building_access_type IN ('fob', 'front_desk', 'alarm_code'));

COMMENT ON COLUMN client_properties.zone_type IS
  'v8.3 E11 D.11.5: usado por getNoiseWindow()/isWithinNoiseWindow() (src/lib/neighborhood.ts) para reglas de ruido por tipo de zona.';

-- Quejas de vecinos registradas -- marca la dirección como "sensible" (spec).
CREATE TABLE IF NOT EXISTS neighbor_complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_property_id UUID NOT NULL REFERENCES client_properties(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  reported_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_neighbor_complaints_property ON neighbor_complaints(client_property_id);

ALTER TABLE neighbor_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees insert neighbor complaints" ON neighbor_complaints;
CREATE POLICY "Employees insert neighbor complaints" ON neighbor_complaints
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Supervisors read neighbor complaints" ON neighbor_complaints;
CREATE POLICY "Supervisors read neighbor complaints" ON neighbor_complaints
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON neighbor_complaints;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON neighbor_complaints
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Leads de vecinos registrados en campo, sin cotizar en el momento (spec).
CREATE TABLE IF NOT EXISTS neighbor_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  source_property_id UUID REFERENCES client_properties(id),
  notes TEXT,
  reported_by UUID REFERENCES employees(id),
  converted_to_client BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE neighbor_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees insert neighbor leads" ON neighbor_leads;
CREATE POLICY "Employees insert neighbor leads" ON neighbor_leads
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Supervisors manage neighbor leads" ON neighbor_leads;
CREATE POLICY "Supervisors manage neighbor leads" ON neighbor_leads
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON neighbor_leads;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON neighbor_leads
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
