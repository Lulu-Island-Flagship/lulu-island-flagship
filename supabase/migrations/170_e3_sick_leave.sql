-- Migración 170 — Días de enfermedad (BC ESA Parte 5.1): 5 pagados + 3 no
-- pagados con protección de empleo por año calendario, tras 90 días de
-- empleo continuo. Antes de eso, discrecional (se documenta igual).
--
-- El empleado puede reportar con excusa simple en texto O nota médica --
-- la ley no exige nota para ausencias cortas, así que ninguna vía es
-- obligatoria sobre la otra (ver src/lib/sick-leave.ts).

CREATE TABLE IF NOT EXISTS sick_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  absence_date DATE NOT NULL,
  reason_type TEXT NOT NULL CHECK (reason_type IN ('self_reported', 'medical_note')),
  reason_text TEXT NOT NULL,
  document_path TEXT, -- ruta privada en el bucket 'sick-notes', si adjuntó nota médica
  days_employed_at_request INTEGER NOT NULL,
  pay_type TEXT NOT NULL CHECK (pay_type IN ('paid', 'unpaid_protected', 'discretionary')),
  eligibility_reason TEXT NOT NULL,
  paid_amount_cents INTEGER,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, absence_date)
);

CREATE INDEX IF NOT EXISTS idx_sick_leave_requests_employee ON sick_leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_sick_leave_requests_date ON sick_leave_requests(absence_date);

-- Inmutable: es el registro de cumplimiento de la entitlement estatutaria.
DROP TRIGGER IF EXISTS trg_prevent_delete ON sick_leave_requests;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON sick_leave_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE sick_leave_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees manage own sick leave requests" ON sick_leave_requests;
CREATE POLICY "Employees manage own sick leave requests" ON sick_leave_requests
  FOR ALL USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors manage all sick leave requests" ON sick_leave_requests;
CREATE POLICY "Supervisors manage all sick leave requests" ON sick_leave_requests
  FOR ALL USING (is_supervisor(auth.uid()));

COMMENT ON TABLE sick_leave_requests IS
  'v8.3: BC ESA Parte 5.1. src/lib/sick-leave.ts decide pay_type (paid/unpaid_protected/discretionary) según días empleados y días ya usados en el año calendario. document_path es opcional -- una excusa en texto (reason_type=self_reported) es igual de válida que una nota médica adjunta.';

-- Bucket privado para notas médicas (información de salud sensible --
-- nunca público, solo el propio empleado y supervisores vía RLS+signed URL).
INSERT INTO storage.buckets (id, name, public)
VALUES ('sick-notes', 'sick-notes', false)
ON CONFLICT (id) DO NOTHING;

-- Convención de ruta: '<employee_id>/<timestamp>.<ext>' (mismo patrón que
-- service-photos). RLS por carpeta: cada empleado solo puede subir/leer
-- dentro de su propia carpeta; supervisores leen todo.
DROP POLICY IF EXISTS "Employees upload own sick notes" ON storage.objects;
CREATE POLICY "Employees upload own sick notes" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'sick-notes'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees read own sick notes" ON storage.objects;
CREATE POLICY "Employees read own sick notes" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'sick-notes'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read all sick notes" ON storage.objects;
CREATE POLICY "Supervisors read all sick notes" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'sick-notes' AND is_supervisor(auth.uid()));
