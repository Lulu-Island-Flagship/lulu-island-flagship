-- Módulo de Cliente -- fix de cumplimiento CASL (auditoría 2026-07-31,
-- hallazgo #2). `clients` (269) no tenía ningún campo de opt-in de
-- marketing, así que client-communication-service.ts (280) no tenía forma
-- real de verificar consentimiento antes de encolar un mensaje
-- communication_type='marketing' -- el archivo lo dejaba documentado como
-- [ASSUMPTION] responsabilidad de "otra capa" que en la práctica no
-- existía. Se agrega el campo aquí, en su propio módulo, DISTINTO del
-- sistema B2C legacy (client_profiles.marketing_opt_in, migración de
-- comunicación anterior) -- son dos módulos de cliente independientes,
-- cada uno con su propio consentimiento de marketing.
--
-- Por qué DEFAULT false (opt-out por defecto) y no NULL: CASL exige
-- consentimiento explícito afirmativo (opt-in), nunca implícito -- un
-- cliente nuevo sin preferencia declarada NUNCA debe poder recibir
-- marketing por defecto. `clients` es un módulo desplegado hoy mismo sin
-- datos reales de producción todavía (confirmado en la sesión de trabajo
-- que creó este módulo), así que no hay backfill que considerar: todo
-- cliente existente (si lo hay) queda correctamente en false/sin opt-in
-- hasta que reafirme explícitamente.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN clients.marketing_opt_in IS
  'CASL: opt-in explícito de marketing para el Módulo de Cliente (distinto '
  'de client_profiles.marketing_opt_in del sistema B2C legacy). Default '
  'false -- nunca se asume consentimiento. Verificado por '
  'queueCommunication() (client-communication-service.ts) antes de encolar '
  'communication_type=''marketing''.';
