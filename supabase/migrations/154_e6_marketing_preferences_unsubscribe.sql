-- Migración 154 — v8.3 E6.5: Centro de preferencias + CASL. "opt-in
-- explícito no pre-marcado, registro inmutable, unsubscribe <24h de un
-- toque, re-engagement (5 emails sin abrir → último intento → fuera)".
--
-- Hasta ahora el único registro de consentimiento de marketing vivía en
-- `quotes.consent_marketing` -- un snapshot histórico POR COTIZACIÓN, no un
-- estado ACTUAL de la cuenta. No existía ningún lugar donde el sistema
-- pudiera preguntar "¿esta cuenta está opt-in a marketing HOY?" ni un link
-- de un solo toque para darse de baja (obligación legal CASL). Esta
-- migración agrega ese estado a `client_profiles` (fuente única de verdad
-- para envíos futuros) sin tocar los snapshots históricos de `quotes`
-- (siguen siendo el registro inmutable de qué se consintió en cada
-- cotización, invariante B.2.10).

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_updated_at TIMESTAMPTZ,
  -- Token estable para el link de unsubscribe de un toque (CASL: sin login,
  -- sin fricción). No se regenera al usarse -- reutilizable si el cliente
  -- quiere volver a optar por email desde el centro de preferencias (que sí
  -- requiere login).
  ADD COLUMN IF NOT EXISTS unsubscribe_token UUID UNIQUE DEFAULT gen_random_uuid(),
  -- Marca de baja automática por re-engagement fallido (D.10/E6.5: "5 emails
  -- sin abrir → último intento → fuera"), distinta de una baja manual, para
  -- que el admin pueda diferenciar ambas en reportes.
  ADD COLUMN IF NOT EXISTS auto_unsubscribed_at TIMESTAMPTZ;

-- Backfill honesto: una cuenta que ya dio consent_marketing=true en
-- CUALQUIER cotización histórica se considera opt-in hoy (no se pierde un
-- consentimiento ya otorgado por no haber existido esta columna antes).
-- Cuentas sin ese consentimiento en ninguna cotización quedan en su default
-- correcto de CASL: false (opt-in explícito, nunca pre-marcado).
UPDATE client_profiles cp
SET marketing_opt_in = true,
    marketing_opt_in_updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM quotes q
  WHERE q.user_id = cp.user_id AND q.consent_marketing = true
)
AND cp.marketing_opt_in = false;

CREATE INDEX IF NOT EXISTS idx_client_profiles_unsubscribe_token ON client_profiles(unsubscribe_token);

COMMENT ON COLUMN client_profiles.marketing_opt_in IS
  'v8.3 E6.5: estado ACTUAL de opt-in de marketing de la cuenta (distinto de quotes.consent_marketing, que es snapshot histórico inmutable por cotización).';

-- ============================================================
-- Unsubscribe de un toque, SIN login (CASL: <24h de un toque). RPC
-- SECURITY DEFINER acotado a una sola escritura posible (marketing_opt_in =
-- false por token exacto) -- deliberadamente no se expone una policy RLS de
-- UPDATE público sobre client_profiles, que sería una superficie mucho más
-- amplia. Idempotente: llamar dos veces con el mismo token no falla ni
-- cambia el resultado.
-- ============================================================
CREATE OR REPLACE FUNCTION unsubscribe_by_token(p_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  UPDATE client_profiles
  SET marketing_opt_in = false,
      marketing_opt_in_updated_at = now()
  WHERE unsubscribe_token = p_token
  RETURNING true INTO v_found;

  RETURN COALESCE(v_found, false);
END;
$$;

COMMENT ON FUNCTION unsubscribe_by_token(UUID) IS
  'v8.3 E6.5: unsubscribe de un toque sin login. Único efecto posible: marketing_opt_in=false para la cuenta dueña del token.';

GRANT EXECUTE ON FUNCTION unsubscribe_by_token(UUID) TO anon, authenticated;
