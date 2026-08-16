-- v5.0 (auditoría de invariantes 2026-08-15, docs/audit-v5-instance.md):
-- dos políticas con USING (true) sin cláusula TO quedaban implícitamente
-- abiertas a PUBLIC (anon + authenticated), contradiciendo la regla
-- INST-AUTH-001 (prohibido USING (true) sin TO explícito).
-- Aquí se hace el alcance EXPLÍCITO sin cambiar la semántica intencionada.

-- vehicles: la política "Employees read vehicles" era para empleados
-- autenticados, no para anónimos.
ALTER POLICY "Employees read vehicles" ON vehicles TO authenticated;

-- feature_flags: la lectura pública ES intencional (feature gating del
-- cliente); se hace explícita en vez de implícita.
ALTER POLICY "Public read feature flags" ON feature_flags TO public;
