-- Fix (auditoría MANIFEST v4.2, 2026-08-14 · C.1 Authz / RLS):
-- La política "Service role full access financial ledger" se creó SIN cláusula
-- `TO`, así que en Postgres aplicaba a PUBLIC (anon/authenticated) y abría
-- lectura Y escritura del libro mayor contable a cualquier rol, contradiciendo
-- su propio comentario ("solo service_role inserta").
--
-- `service_role` ya salta RLS, así que el `TO service_role` no le quita ni le
-- da nada a service_role; lo que corrige es que la política deje de abrir la
-- tabla a roles de usuario. La lectura de supervisores sigue cubierta por la
-- política "Supervisors read financial ledger" (FOR SELECT ... is_supervisor()).
ALTER TABLE financial_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access financial ledger" ON financial_ledger;
CREATE POLICY "Service role full access financial ledger" ON financial_ledger
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
