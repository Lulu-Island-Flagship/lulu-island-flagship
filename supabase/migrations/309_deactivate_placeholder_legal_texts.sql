-- Fix (auditoría externa 2026-08-02, hallazgo CRÍTICO #1): las migraciones
-- 255_hiring_flow_seed_legal_texts.sql y
-- 274_client_module_seed_legal_texts.sql insertaron textos legales
-- placeholder (contenido estructural literal "[PLACEHOLDER ...]" / "...
-- PENDIENTE DE REVISIÓN LEGAL...") con is_active = true. Bajo PIPA/BC un
-- consentimiento recabado sobre un texto que ni siquiera es el texto legal
-- real es inválido -- cualquier candidato o cliente que haya aceptado estos
-- textos placeholder en producción "consintió" a un documento que no dice
-- nada legalmente vinculante real.
--
-- Esta migración NO borra esas filas -- son registro histórico de qué
-- contenido exacto se le mostró a cada candidato/cliente que consintió
-- mientras estuvieron activas (necesario para auditoría, y porque
-- legal_texts/consent tables referencian legal_text_id por fila). Solo
-- las desactiva (is_active = false) para que:
--   (a) legal-text-service.ts (renderLegalText) deje de poder resolver una
--       versión activa para estas keys -- cualquier código que intente
--       mostrar o registrar un nuevo consentimiento sobre ellas falla con
--       LegalTextNotFoundError (reason "no_active_version") en vez de
--       servir el placeholder silenciosamente.
--   (b) quede explícito en la base que NINGUNA de estas versions v1.0 es
--       apta para producción hasta que legal las revise y una operación
--       administrativa explícita inserte + active el contenido real.
--
-- Efecto operativo esperado (intencional, no es un bug de esta migración):
-- tras aplicar esto, el flujo público de aplicación a empleo
-- (POST /api/hiring-flow/apply, key "pipa_step1") y cualquier flujo del
-- módulo de cliente que dependa de "client_service_agreement",
-- "client_pipa_consent", "client_photo_consent",
-- "client_key_handling_policy", "client_cancellation_policy" o
-- "client_damage_liability" dejarán de funcionar (error explícito, no
-- silencioso) hasta que alguien inserte una nueva versión con el
-- contenido legal real y is_active = true. Esto es preferible a seguir
-- recabando consentimiento inválido.
--
-- No se toca "crc_consent" (background check) de todos modos porque
-- también es placeholder -- se incluye igual en el UPDATE de abajo.
--
-- El filtro `AND content ILIKE '%PLACEHOLDER%'` es una red de seguridad
-- adicional: si por lo que sea alguna de estas filas ya hubiera sido
-- reemplazada por contenido real vía una operación administrativa antes de
-- que esta migración corriera, no la tocamos.

UPDATE legal_texts
SET is_active = false
WHERE key IN (
  'pipa_step1',
  'crc_consent',
  'client_service_agreement',
  'client_pipa_consent',
  'client_photo_consent',
  'client_key_handling_policy',
  'client_cancellation_policy',
  'client_damage_liability'
)
  AND version = 'v1.0'
  AND is_active = true
  AND content ILIKE '%PLACEHOLDER%';
