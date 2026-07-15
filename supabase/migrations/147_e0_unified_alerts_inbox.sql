-- Migración 146 — v8.3 E0.6: bandeja unificada de alertas.
--
-- "Una sola cola, dos niveles ('responder en 10 min' → dispara Fallback;
-- 'puede esperar'). Toda alerta del sistema, de cualquier etapa, entra
-- aquí."
--
-- DISEÑO HONESTO: antes de esta migración, cada módulo de excepción
-- (dispatch-fallback, safety-abort, chemical-lockout, PO reminders, etc.)
-- escribía su propia señal en su propia tabla (tickets_disputas,
-- safety_aborts, wellbeing_chemical_alerts...) sin que existiera una vista
-- consolidada. Esta tabla no reemplaza esas tablas de dominio (siguen siendo
-- la fuente de verdad operativa de cada módulo); es una bitácora de
-- publicación paralela y ligera que cualquier módulo puede escribir para que
-- el admin tenga UNA sola bandeja con las dos prioridades del spec (D.10:
-- "Priorización: P0 seguridad humana → P1 <10 min → P2 automático. Todo
-- entra a la bandeja unificada").
--
-- Solo se conectan aquí, en este pase, los productores más claramente P0/P1
-- que ya existían (SOS de aborto seguro, reasignación por bienestar químico
-- sin respaldo, discrepancias de despacho escaladas) -- ver comentarios en
-- cada ruta que llama a publishUnifiedAlert(). Conectar el resto de
-- productores existentes queda como trabajo incremental, no un big-bang.

CREATE TABLE IF NOT EXISTS unified_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source_module TEXT NOT NULL, -- ej. 'safety_abort', 'wellbeing_chemical', 'dispatch_discrepancy'
  source_table TEXT,           -- tabla de dominio de origen (ej. 'safety_aborts'), para navegar al detalle real
  source_id UUID,              -- id de la fila de origen en esa tabla

  tier TEXT NOT NULL CHECK (tier IN ('respond_10min', 'can_wait')),
  severity TEXT NOT NULL DEFAULT 'p1_urgent' CHECK (severity IN ('p0_safety', 'p1_urgent', 'p2_automatic')),

  title TEXT NOT NULL,
  summary TEXT,

  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'auto_resolved')),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES employees(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES employees(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_unified_alerts_status_tier ON unified_alerts(status, tier);
CREATE INDEX IF NOT EXISTS idx_unified_alerts_created ON unified_alerts(created_at DESC);

ALTER TABLE unified_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read unified alerts" ON unified_alerts;
CREATE POLICY "Supervisors read unified alerts" ON unified_alerts
  FOR SELECT USING (is_supervisor(auth.uid()));

DROP POLICY IF EXISTS "Supervisors manage unified alerts" ON unified_alerts;
CREATE POLICY "Supervisors manage unified alerts" ON unified_alerts
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON unified_alerts;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON unified_alerts
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE unified_alerts IS
  'v8.3 E0.6: bandeja unificada de alertas (dos niveles: respond_10min/can_wait). Bitácora de publicación paralela -- no reemplaza las tablas de dominio de cada módulo.';
