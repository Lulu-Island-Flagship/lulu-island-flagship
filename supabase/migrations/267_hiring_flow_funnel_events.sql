-- v0.4.1 (flujo de contratación) -- Fase 2 "Modelo de Datos Completo".
-- `funnel_events` es la tabla de HECHOS de transición de estado de un
-- candidato -- una fila por cada cambio (`from_status` -> `to_status`).
--
-- Regla explícita del plan: los reportes deben leer de funnel_events
-- (tabla de hechos), NO de `candidates.status` (estado actual, 257). Si
-- un candidato pasó de step1_completed a step2_completed y luego a
-- rejected, `candidates.status` hoy dice 'rejected' -- pero un reporte de
-- funnel (ej. "cuántos candidatos llegaron a step2") debe poder contar
-- que SÍ entró y avanzó hasta step2 en algún momento, aunque su estado
-- final sea otro. Leer solo el estado actual subcontaría ese tipo de
-- eventos y distorsionaría cualquier análisis de conversión por etapa.
--
-- Por qué `from_status`/`to_status` son TEXT libres y no un CHECK contra
-- el mismo enum de `candidates.status`: `event_type` puede registrar
-- transiciones o eventos que no necesariamente son una fila de status
-- (ej. "documento_subido", "email_reenviado") -- atar el CHECK al enum
-- de candidates acoplaría esta tabla de hechos genérica a un modelo más
-- estrecho del que necesita. `from_status` es nullable porque el primer
-- evento de un candidato no tiene estado previo.
--
-- Por qué esta tabla, igual que audit_logs (265)/electronic_signatures
-- (262)/consents (263), es solo INSERT+SELECT sin UPDATE/DELETE: una
-- tabla de hechos que se puede editar deja de ser confiable como fuente
-- de reportes -- debe ser append-only.

CREATE TABLE IF NOT EXISTS funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_candidate_id ON funnel_events (candidate_id);
CREATE INDEX IF NOT EXISTS idx_funnel_events_event_type ON funnel_events (event_type);
CREATE INDEX IF NOT EXISTS idx_funnel_events_created_at ON funnel_events (created_at);

ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;

-- Solo INSERT y SELECT, service-role-only. Deliberadamente SIN policy de
-- UPDATE ni DELETE -- tabla de hechos append-only, fuente de verdad para
-- reportes de funnel (ver comentario de cabecera).
DROP POLICY IF EXISTS "funnel_events no direct insert" ON funnel_events;
CREATE POLICY "funnel_events no direct insert" ON funnel_events
  FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "funnel_events no direct select" ON funnel_events;
CREATE POLICY "funnel_events no direct select" ON funnel_events
  FOR SELECT USING (false);

COMMENT ON TABLE funnel_events IS
  'v0.4.1 flujo de contratación: tabla de hechos de transición de '
  'estado de candidatos. Los reportes deben leer de aquí, NO de '
  'candidates.status (estado actual) -- un candidato que pasó por step2 '
  'y terminó rejected debe seguir contando como que llegó a step2. '
  'Append-only. Acceso exclusivo vía service role.';
