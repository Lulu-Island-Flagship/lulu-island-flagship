-- Migración 095 — v8.3 E11.3/E11.4: Recuperación de desastres declarada y
-- probada. Antes de esta migración no existía ninguna tabla, RPC ni ruta que
-- registrara CUÁNDO se corrió un simulacro, QUÉ se probó y el RESULADO — el
-- criterio de aceptación E11 ("Restauración de backup ejecutada y
-- cronometrada dentro de los SLA declarados") era imposible de demostrar.
--
-- DISEÑO HONESTO: esto NO reemplaza los backups gestionados de Supabase
-- (Point-in-Time Recovery / snapshots automáticos, ya cubiertos por el plan
-- de Supabase contratado) ni el `pg_dump` mensual a almacenamiento frío
-- (D.9.10 / E11.3, fuera del alcance de código de esta app). Esta tabla
-- registra el HISTORIAL de simulacros y su resultado verificable, para que
-- el criterio "restauración cada 6 meses" (E11.4) sea auditable en pantalla
-- en vez de vivir solo en la memoria del dueño.

CREATE TABLE IF NOT EXISTS disaster_recovery_drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tipo de simulacro. 'restore_verification' es el único que esta app puede
  -- ejecutar y verificar por sí misma hoy (POST /api/admin/dr-drill, RPC
  -- dr_drill_integrity_check). Los demás tipos declarados en el plan E11.4
  -- (sucesión, kit de emergencia, Fallback sin admin) se registran aquí como
  -- bitácora manual — el admin anota que los corrió, sin verificación
  -- automática, porque no son estados que la base de datos pueda comprobar
  -- por sí sola.
  drill_type TEXT NOT NULL CHECK (drill_type IN (
    'restore_verification',   -- verificado automáticamente por dr_drill_integrity_check
    'succession_simulation',  -- bitácora manual, E11.4
    'emergency_kit_check',    -- bitácora manual, E11.4
    'fallback_no_admin'       -- bitácora manual, E11.4
  )),

  -- Qué se probó, en texto libre estructurado por el admin (ej. "restore de
  -- staging desde pg_dump del 2026-07-01" o "kit físico revisado en sobre
  -- sellado, sello intacto, credenciales vigentes").
  tested_scope TEXT NOT NULL,

  result TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'partial')),

  -- Detalle estructurado del resultado. Para 'restore_verification' contiene
  -- el conteo de filas por tabla crítica y los checks de integridad
  -- referencial devueltos por dr_drill_integrity_check (ver migración 097).
  verification_details JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Tiempo que tomó el simulacro, para comparar contra el RTO declarado
  -- (rto_targets, migración 096). NULL para bitácoras manuales sin cronómetro.
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),

  notes TEXT,
  run_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_drills_type_date ON disaster_recovery_drills(drill_type, created_at DESC);

ALTER TABLE disaster_recovery_drills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner reads dr drills" ON disaster_recovery_drills;
CREATE POLICY "owner reads dr drills" ON disaster_recovery_drills
  FOR SELECT USING (has_admin_role(auth.uid(), ARRAY['owner_admin']));

DROP POLICY IF EXISTS "owner inserts dr drills" ON disaster_recovery_drills;
CREATE POLICY "owner inserts dr drills" ON disaster_recovery_drills
  FOR INSERT WITH CHECK (has_admin_role(auth.uid(), ARRAY['owner_admin']));

-- Registro histórico inmutable: nunca se corrige un simulacro pasado, se
-- corre uno nuevo (misma filosofía que config_snapshots, migración 042).
DROP TRIGGER IF EXISTS trg_prevent_delete ON disaster_recovery_drills;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON disaster_recovery_drills
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

DROP TRIGGER IF EXISTS trg_prevent_update ON disaster_recovery_drills;
CREATE OR REPLACE FUNCTION prevent_dr_drill_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'disaster_recovery_drills es un registro histórico inmutable — corra un nuevo simulacro en vez de editar uno pasado'
    USING ERRCODE = 'raise_exception';
END;
$$;
CREATE TRIGGER trg_prevent_update BEFORE UPDATE ON disaster_recovery_drills
  FOR EACH ROW EXECUTE FUNCTION prevent_dr_drill_update();

COMMENT ON TABLE disaster_recovery_drills IS
  'v8.3 E11.4: bitácora inmutable de simulacros de recuperación de desastres. result=pass/fail/partial, verification_details estructurado para restore_verification.';
