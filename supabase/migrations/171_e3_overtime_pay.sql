-- Migración 171 — Recargo de horas extra (BC ESA / v8.3 B.2.15): 1.5x
-- sobre el excedente de 8h estándar. src/lib/payroll.ts#calculateOvertimePay
-- calcula el monto; estas columnas quedan listas en payroll_entries para
-- cuando exista el paso que genera la nómina real (ver LIMITACIÓN
-- DOCUMENTADA en ese archivo: hoy ninguna ruta inserta en payroll_entries).

ALTER TABLE payroll_entries
  ADD COLUMN IF NOT EXISTS total_day_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_amount INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN payroll_entries.overtime_minutes IS
  'Minutos por encima de 8h estándar ese día para el empleado (workday.ts STANDARD_DAY_MINUTES), calculados por calculateOvertimePay.';
COMMENT ON COLUMN payroll_entries.overtime_amount IS
  'Recargo 1.5x sobre el excedente de horas extra, en centavos CAD. Ya incluido en gross_amount cuando se aplica.';
