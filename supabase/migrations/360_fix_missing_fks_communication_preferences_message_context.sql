-- Migration 360: Add missing foreign keys to auth.users
-- Auditoría 2026-08-06: communication_preferences.user_id y
-- message_context.linked_by_user_id referencian auth.users pero sin FK,
-- rompiendo integridad referencial. Las políticas RLS de la migración 356
-- ya asumen auth.uid() = user_id, así que el FK es el enforcement natural.
--
-- communication_preferences: ON DELETE CASCADE (si se borra el usuario,
-- sus preferencias de comunicación dejan de tener sentido).
-- message_context: ON DELETE SET NULL (el contexto histórico del mensaje
-- puede seguir siendo útil aunque el usuario ya no exista).

BEGIN;

-- 1. FK en communication_preferences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_communication_preferences_user_id'
    AND table_name = 'communication_preferences'
  ) THEN
    ALTER TABLE communication_preferences
      ADD CONSTRAINT fk_communication_preferences_user_id
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. FK en message_context
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_message_context_linked_by_user_id'
    AND table_name = 'message_context'
  ) THEN
    ALTER TABLE message_context
      ADD CONSTRAINT fk_message_context_linked_by_user_id
      FOREIGN KEY (linked_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
