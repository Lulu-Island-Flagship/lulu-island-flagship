-- Migración 166 — v8.3 E9.4: "WorkSafeBC ... certificaciones con
-- vencimiento y bloqueo, CRA (T4 anual, T4A partners, CPP/EI mensual,
-- GST/PST trimestral NETFILE), logs inmutables con hash."
--
-- WorkSafeBC (incidentes 72h) y T4A de partners (partner_commissions,
-- migración 147) ya existían. Esta migración cubre lo que faltaba:
-- 1) certificaciones de empleados con vencimiento real (antes solo se
--    afirmaban manualmente, ver src/lib/career-path.ts), y
-- 2) el calendario/esqueleto de obligaciones CRA (CPP/EI, GST/PST, T4).

-- ============================================================
-- 1. Certificaciones de empleados (química, 3 niveles progresivos)
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  certificate_type TEXT NOT NULL DEFAULT 'chemical_handling',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  document_url TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_certifications_employee ON employee_certifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_certifications_expires ON employee_certifications(expires_at);

ALTER TABLE employee_certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees read own certifications" ON employee_certifications;
CREATE POLICY "Employees read own certifications" ON employee_certifications
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors manage certifications" ON employee_certifications;
CREATE POLICY "Supervisors manage certifications" ON employee_certifications
  FOR ALL USING (is_supervisor(auth.uid()));

COMMENT ON TABLE employee_certifications IS
  'v8.3 E9.4/E7/D.9: certificación química de 3 niveles con vencimiento real. src/lib/certifications.ts decide vigencia; el cron dispatch-scheduler excluye del despacho a quien no tenga ninguna vigente (mismo patrón que seguro vehicular vencido, migración 047).';

-- ============================================================
-- 2. Calendario de obligaciones CRA (esqueleto, no un motor fiscal)
-- ============================================================
CREATE TABLE IF NOT EXISTS cra_remittance_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_type TEXT NOT NULL CHECK (remittance_type IN ('cpp_ei_monthly', 'gst_pst_quarterly', 't4_annual')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'filed')),
  filed_at TIMESTAMPTZ,
  filed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmation_reference TEXT,
  amount_cents INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (remittance_type, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_cra_remittance_periods_due ON cra_remittance_periods(due_date);
CREATE INDEX IF NOT EXISTS idx_cra_remittance_periods_status ON cra_remittance_periods(status);

ALTER TABLE cra_remittance_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors manage CRA remittance periods" ON cra_remittance_periods;
CREATE POLICY "Supervisors manage CRA remittance periods" ON cra_remittance_periods
  FOR ALL USING (is_supervisor(auth.uid()));

COMMENT ON TABLE cra_remittance_periods IS
  'v8.3 E9.4: calendario de vencimientos CRA (CPP/EI mensual, GST/PST trimestral, T4 anual) generado por src/lib/cra-remittances.ts. Es un recordatorio con estado pendiente/presentado -- el NETFILE real y el monto exacto se hacen fuera de este sistema (QBO/contador); amount_cents es informativo, capturado manualmente al marcar presentado.';
