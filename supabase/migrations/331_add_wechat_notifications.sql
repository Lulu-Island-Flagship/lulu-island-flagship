-- v0.1 Ola 2: WeChat notification preference y recordatorios
-- Richmond, BC tiene ~40% de población de origen chino. Permitir que el
-- cliente active recordatorios por WeChat es un diferenciador real.
--
-- Esta migración agrega:
-- 1. Columna `wechat_notifications` en `client_profiles` (boolean, default false)
-- 2. Columna `wechat_openid` en `client_profiles` (TEXT nullable, para vincular
--    la cuenta de WeChat del cliente en el futuro)
--
-- El envío real por WeChat requiere integración con WeChat Official Account
-- API (fuera de alcance de esta migración — solo se crea la preferencia y el
-- placeholder para el ID). Mientras `wechat_openid` sea NULL, los recordatorios
-- por WeChat se ignoran silenciosamente (mismo patrón que SMS sin Twilio
-- configurado).
--
-- NO es una columna PII sensible: es una preferencia de notificación y un ID
-- externo opaco. No requiere cifrado ni RLS especial más allá de lo que ya
-- tiene client_profiles.

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS wechat_notifications BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS wechat_openid TEXT;

COMMENT ON COLUMN client_profiles.wechat_notifications IS
  'v0.1 Ola 2: true si el cliente quiere recibir recordatorios por WeChat '
  '(además de SMS/email). Sin UI todavía para setearlo — el toggle se agrega '
  'en CommunicationPreferencesClient.';

COMMENT ON COLUMN client_profiles.wechat_openid IS
  'v0.1 Ola 2: WeChat OpenID del cliente (placeholder). Se poblará cuando se '
  'integre WeChat Official Account login o vinculación de cuenta. NULL = no '
  'vinculado. No es PII sensible.';
