-- Migración crítica: separar disputas perdidas de disputas totales en el score del cliente.
-- El spec v8.2 penaliza -25 por disputa PERDIDA, no por cualquier disputa.

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS disputes_lost_count INTEGER NOT NULL DEFAULT 0;

-- Función RPC para incrementar contador de disputas perdidas de forma atómica
CREATE OR REPLACE FUNCTION increment_disputes_lost_count(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE client_profiles
  SET disputes_lost_count = disputes_lost_count + 1,
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;
