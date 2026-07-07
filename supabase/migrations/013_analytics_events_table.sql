-- Migración: Tabla de analytics events para tracking de CTA clicks (Módulo 6 - Marketing)
-- Creada: 2026-07-07

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  variant TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  page_url TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para queries por evento y fecha
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_time ON analytics_events(event_type, timestamp DESC);

-- Índice para queries por usuario
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id, timestamp DESC);

-- RLS: solo admins/supervisores pueden leer; inserts anónimos permitidos para tracking
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous inserts" ON analytics_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Supervisors can read all" ON analytics_events
  FOR SELECT TO authenticated USING (is_supervisor(auth.uid()));
