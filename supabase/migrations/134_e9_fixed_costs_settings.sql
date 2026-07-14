-- Migración 134 — v8.3 E9 (D.3/D.13): costos fijos mensuales, editables por
-- el dueño, versionados igual que pricing_settings (028).
--
-- Contexto: D.3 exige que el sistema muestre SIEMPRE "Margen_contribucion" y
-- "Margen_neto_real" por separado, nunca fusionados — Margen_neto_real =
-- Margen_contribucion − (Costos_fijos_mes ÷ servicios_del_mes). El dato de
-- costos fijos mensuales (renta, seguros, software, etc.) no existía en
-- ningún lado: sin él, el margen neto real es matemáticamente imposible de
-- calcular y D.13 (dashboard del dueño) no puede mostrar su quinta métrica.
--
-- Diseño: un solo campo editable, versionado con effective_from/effective_to
-- (mismo patrón que pricing_settings) para que el margen neto real de meses
-- pasados se recalcule con el costo fijo vigente EN ESE MES, no con el
-- actual. Solo owner_admin — es información financiera sensible (finance,
-- ya restringido en admin-rbac.ts).

CREATE TABLE IF NOT EXISTS fixed_costs_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_fixed_costs_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fixed_costs_cents >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  reason TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fixed_costs_settings_current
  ON fixed_costs_settings (effective_from)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_fixed_costs_settings_effective
  ON fixed_costs_settings (effective_from, effective_to);

ALTER TABLE fixed_costs_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_admin manages fixed costs settings" ON fixed_costs_settings;
CREATE POLICY "owner_admin manages fixed costs settings" ON fixed_costs_settings
  FOR ALL USING (has_admin_role(auth.uid(), ARRAY['owner_admin']))
  WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

-- Historial inmutable: nunca se corrige un costo pasado con UPDATE/DELETE de
-- la fila cerrada, solo se cierra (effective_to) y se inserta una nueva.
DROP TRIGGER IF EXISTS trg_prevent_delete ON fixed_costs_settings;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON fixed_costs_settings
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Fila inicial: $0/mes hasta que el dueño la ajuste a su costo real. Un
-- default de $0 nunca produce un margen neto FALSO optimista de forma
-- silenciosa -- el dashboard debe mostrar explícitamente "not set" cuando
-- monthly_fixed_costs_cents = 0 Y no hay ninguna fila con reason distinto
-- del seed, para que el dueño sepa que debe configurarlo (ver
-- src/lib/dashboard-metrics.ts).
INSERT INTO fixed_costs_settings (monthly_fixed_costs_cents, effective_from, reason)
VALUES (0, '2026-06-01', 'Seed inicial v8.3 E9 — pendiente de configurar por el dueño')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION get_current_monthly_fixed_costs_cents()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT monthly_fixed_costs_cents
     FROM fixed_costs_settings
     WHERE effective_to IS NULL
     ORDER BY effective_from DESC
     LIMIT 1),
    0
  );
$$;

COMMENT ON TABLE fixed_costs_settings IS
  'v8.3 E9/D.3/D.13: costos fijos mensuales del negocio, versionados. Único insumo faltante para calcular Margen_neto_real = Margen_contribucion - (costos_fijos_mes / servicios_del_mes).';
