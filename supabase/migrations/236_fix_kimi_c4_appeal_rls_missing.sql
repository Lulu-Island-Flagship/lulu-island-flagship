-- Fix Kimi-C4 (auditoría externa Kimi Code, 2026-07-21) -- esta vez la cita
-- de Kimi fue EXACTA: src/app/api/empleado/appeal/route.ts:88-97 y
-- supabase/migrations/010_modulo7_qc_score_tables.sql:60-70 son los
-- archivos y líneas reales. Verificado por Claude antes de aplicar:
--
-- field_audits (migración 010) solo tiene 4 políticas RLS:
--   "Employees read own audits"   FOR SELECT (dueño)
--   "Supervisors read all audits" FOR SELECT
--   "Supervisors insert audits"   FOR INSERT
--   "Supervisors update audits"   FOR UPDATE (solo is_supervisor)
--
-- NINGUNA política permite a un empleado hacer UPDATE de su propia fila.
-- src/app/api/empleado/appeal/route.ts usa la clave anon + sesión del
-- empleado (NO service_role) y hace exactamente eso en la línea 88-97
-- (`supabase.from("field_audits").update({appealed_at, appeal_reason,
-- appeal_deadline}).eq("id", auditId)`) -- RLS descarta la escritura sin
-- error explícito (0 filas afectadas), y el `.select().single()`
-- inmediatamente después revienta con "no rows returned" -- la ruta
-- SIEMPRE responde 500. Confirmado: el botón de apelación del empleado
-- está roto en producción hoy, para cualquier empleado, siempre.
--
-- Fix: nueva política UPDATE que permite al empleado dueño de la fila
-- apelar SOLO mientras no haya apelado ya (USING exige appealed_at IS
-- NULL, coincide con el guard que la propia ruta ya hace en código antes
-- de llamar UPDATE -- doble capa, no solo una). Como RLS no restringe QUÉ
-- columnas cambian dentro de la fila permitida (solo si la fila entra o no
-- en la política), se agrega además un trigger de blindaje (mismo patrón
-- que RAÍZ-1, migración 214) que solo deja tocar appealed_at,
-- appeal_reason, appeal_deadline cuando quien ejecuta no es
-- service_role/postgres/supabase_admin -- así un empleado no puede, vía
-- REST directo, reescribir su propio score, notes, auditor_id, etc.
CREATE POLICY "Employees appeal own unresolved audits" ON field_audits
  FOR UPDATE
  USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    AND appealed_at IS NULL
  )
  WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION prevent_employee_field_audit_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_cols text[] := ARRAY['appealed_at', 'appeal_reason', 'appeal_deadline'];
  old_j jsonb;
  new_j jsonb;
  k text;
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  old_j := to_jsonb(OLD);
  new_j := to_jsonb(NEW);

  FOR k IN SELECT jsonb_object_keys(old_j) LOOP
    IF k = ANY(allowed_cols) THEN
      CONTINUE;
    END IF;
    IF old_j -> k IS DISTINCT FROM new_j -> k THEN
      RAISE EXCEPTION
        'Fix Kimi-C4: la sesión de empleado no puede modificar la columna "%" de field_audits (audit_id=%). '
        'Solo appealed_at/appeal_reason/appeal_deadline son escribibles desde la apelación del empleado.',
        k, OLD.id
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_employee_field_audit_tampering ON field_audits;
CREATE TRIGGER trg_prevent_employee_field_audit_tampering
  BEFORE UPDATE ON field_audits
  FOR EACH ROW EXECUTE FUNCTION prevent_employee_field_audit_tampering();

COMMENT ON FUNCTION prevent_employee_field_audit_tampering() IS
  'Fix Kimi-C4 (migración 236, 2026-07-21): junto con la política "Employees '
  'appeal own unresolved audits", permite que /api/empleado/appeal funcione '
  '(antes siempre fallaba, sin ninguna política UPDATE para el empleado) '
  'restringiendo qué columnas puede tocar esa sesión: solo appealed_at, '
  'appeal_reason, appeal_deadline. Server-side (service_role) no está sujeto '
  'a esta restricción.';
