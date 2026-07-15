-- Migración 164 — v8.3 E11.7 + E11.8.
--
-- E11.7: bitácora de ejecuciones del escenario de estrés financiero
-- (D.11.7). El criterio de aceptación pide "ejecutado CON EL DUEÑO y
-- palancas documentadas" -- por eso esto no es solo un cálculo efímero en
-- pantalla, sino un registro persistente de cuándo se corrió, con qué
-- inputs, y qué palancas quedaron documentadas como plan.
--
-- E11.8: checklist de cierre de migración legacy (redirect www→app,
-- Godaddy en modo archivo). Mismo patrón que gbp_checklist_items (E10.3):
-- ítems administrables con estado, no una tabla de datos operativos reales.

CREATE TABLE IF NOT EXISTS financial_stress_scenario_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_by UUID REFERENCES auth.users(id),
  current_monthly_revenue_cents INTEGER NOT NULL,
  current_monthly_fixed_costs_cents INTEGER NOT NULL,
  current_monthly_variable_costs_cents INTEGER NOT NULL,
  crosses_mandatory_review_threshold BOOLEAN NOT NULL,
  levers_documented TEXT[] NOT NULL DEFAULT '{}', -- subconjunto de STRESS_LEVERS_IN_ORDER que el dueño decidió documentar como plan
  owner_present BOOLEAN NOT NULL DEFAULT false, -- criterio de aceptación: "ejecutado CON el dueño"
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE financial_stress_scenario_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_stress_scenario_runs_admin_only ON financial_stress_scenario_runs
  FOR ALL USING (false) WITH CHECK (false);

CREATE TRIGGER prevent_hard_delete_financial_stress_scenario_runs
  BEFORE DELETE ON financial_stress_scenario_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE TABLE IF NOT EXISTS legacy_migration_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE legacy_migration_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_migration_checklist_admin_only ON legacy_migration_checklist_items
  FOR ALL USING (false) WITH CHECK (false);

CREATE TRIGGER prevent_hard_delete_legacy_migration_checklist_items
  BEFORE DELETE ON legacy_migration_checklist_items
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

INSERT INTO legacy_migration_checklist_items (item_key, label) VALUES
  ('www_redirect_to_app', 'Redirect www → app (dominio principal apuntando al sistema nuevo)'),
  ('godaddy_archive_mode', 'Godaddy en modo archivo (sitio legacy despublicado, sin aceptar nuevas reservas)'),
  ('godaddy_cancellation_scheduled', 'Cancelación de Godaddy programada (1 mes después del modo archivo, por spec D.11.8)')
ON CONFLICT (item_key) DO NOTHING;
