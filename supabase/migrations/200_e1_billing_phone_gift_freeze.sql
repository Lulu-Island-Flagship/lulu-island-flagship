-- ============================================================
-- E1 (auditoría 2026-07-18) -- 3 columnas de soporte para bugs reales:
--
-- 1. AVS de dirección de facturación (client_profiles no tiene una
--    categoría "regalo"/"cuenta corporativa" real -- account_type solo
--    admite 'b2c'/'b2b'/'government', CHECK en 001_modulo1_base_schema.sql.
--    'b2b'/'government' ya se bloquean por completo antes de este punto del
--    flujo B2C (ver /api/stripe/confirm/route.ts), así que la única
--    excepción real y accionable hoy es la de "regalo": se agrega
--    quotes.is_gift_order para que un cliente que compra un servicio para
--    un tercero (dirección de servicio distinta a la de su propia tarjeta)
--    no sea rechazado/marcado por un mismatch esperado. No existe todavía
--    un flujo de UI que ponga este flag en true -- se deja cableado para
--    cuando exista (ver nota en /api/stripe/confirm/route.ts).
-- 2. Verificación telefónica obligatoria (client_profiles.phone_verified).
-- 3. Renovación de freeze de precio por actividad -- ver quotes.accepted_at
--    (ya existente, migración 001) usado como techo absoluto en
--    /api/quote/freeze-ping.
-- ============================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS is_gift_order BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN quotes.is_gift_order IS
  'v8.3 E1: true si el cliente compra el servicio para un tercero -- excluye '
  'la cotización del chequeo de AVS (dirección de facturación vs. dirección '
  'de servicio) en /api/stripe/confirm. Sin UI todavía para setearlo.';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_postal_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_avs_mismatch BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN orders.billing_avs_mismatch IS
  'v8.3 E1: true si el código postal de facturación (AVS de Stripe) no '
  'coincide con el código postal del servicio (quotes.postal_code) al '
  'momento de confirmar -- la orden NO se bloquea por esto (falsos '
  'positivos son comunes: tarjetas corporativas, familiares, etc.), pero '
  'queda marcada para revisión manual. Ver /api/stripe/confirm/route.ts.';

ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
COMMENT ON COLUMN client_profiles.phone_verified IS
  'v8.3 E1: true solo después de que el cliente prueba posesión del número '
  '(SMS OTP via Supabase Auth, verifyOtp type sms/phone_change). Un login '
  'social (Google/Apple) nunca lo pone en true por sí solo -- '
  'AuthModal.tsx fuerza un paso de verificación separado, y '
  '/api/stripe/confirm lo exige de forma autoritativa antes de confirmar '
  'cualquier reserva.';
