-- Auditoría 2026-08-05: Habilitar RLS en tablas nuevas y corregir políticas
-- Fix items: 2.11 (RLS ausente en 351/354), 2.12 (WITH CHECK(true) en 350)

-- ── 2.11: message_context (351) ──
ALTER TABLE IF EXISTS message_context ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF to_regclass('public.message_context') IS NOT NULL THEN
    -- Solo admins pueden leer los contextos de mensajes
    CREATE POLICY "Admins can read message_context" ON message_context
      FOR SELECT USING (EXISTS (
        SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
      ));
    -- Solo service role escribe (via bypass de RLS)
    CREATE POLICY "Block direct inserts on message_context" ON message_context
      FOR INSERT WITH CHECK (false);
    CREATE POLICY "Block direct updates on message_context" ON message_context
      FOR UPDATE USING (false);
    CREATE POLICY "Block direct deletes on message_context" ON message_context
      FOR DELETE USING (false);
  END IF;
END $$;

-- ── 2.11: communication_preferences (354) ──
ALTER TABLE IF EXISTS communication_preferences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF to_regclass('public.communication_preferences') IS NOT NULL THEN
    -- Usuarios ven y editan sus propias preferencias
    CREATE POLICY "Users can read own preferences" ON communication_preferences
      FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "Users can insert own preferences" ON communication_preferences
      FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "Users can update own preferences" ON communication_preferences
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "Users can delete own preferences" ON communication_preferences
      FOR DELETE USING (auth.uid() = user_id);
    -- Admins pueden ver todas
    CREATE POLICY "Admins can read all preferences" ON communication_preferences
      FOR SELECT USING (EXISTS (
        SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND deleted_at IS NULL
      ));
  END IF;
END $$;

-- ── 2.12: communication_attempts INSERT policy ──
-- La política original (350) usa WITH CHECK (true) — cualquier rol autenticado
-- puede insertar. Dado que esta tabla es solo-escritura via service_role,
-- cambiamos a WITH CHECK (false): solo service_role (que bypassea RLS) inserta.
DO $$ BEGIN
  IF to_regclass('public.communication_attempts') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role can insert communication attempts" ON communication_attempts;
    CREATE POLICY "Service role can insert communication attempts" ON communication_attempts
      FOR INSERT WITH CHECK (false);
  END IF;
END $$;
