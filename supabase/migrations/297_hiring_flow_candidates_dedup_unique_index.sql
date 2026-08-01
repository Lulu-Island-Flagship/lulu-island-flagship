-- v0.4.1 (flujo de contratación) -- Fix de auditoría externa (hallazgo
-- confirmado, Prioridad 3): candidate-step1-service.ts / apply/route.ts no
-- tenían NINGUNA verificación de duplicados. Un mismo candidato podía
-- enviar el formulario público de /empleo repetidas veces (mismo email o
-- mismo teléfono) sin límite, contaminando la tabla `candidates` y
-- duplicando el trabajo de procesamiento de RRHH.
--
-- Por qué un índice único parcial y NO un SELECT-then-INSERT a nivel de
-- aplicación: /api/hiring-flow/apply es un endpoint público sin
-- autenticación. Un chequeo "leer si existe -> si no, insertar" hecho en
-- TypeScript tiene una ventana TOCTOU real bajo concurrencia (dos
-- requests casi simultáneos del mismo candidato -- doble click, retry de
-- red -- pueden pasar ambos el SELECT antes de que cualquiera haga el
-- INSERT). Un índice único a nivel de Postgres es atómico por diseño: la
-- propia base de datos rechaza el segundo INSERT concurrente sin
-- necesidad de locks explícitos ni de lógica adicional en la capa de
-- aplicación. Mismo criterio ya usado en otras partes del repo para este
-- tipo de problema (ver sick_leave_requests / partner_commissions /
-- equipment_reservations: unique constraint + catch de error.code
-- "23505" -> 409 en la ruta HTTP).
--
-- Por qué es PARCIAL (`WHERE status <> 'rejected'`) y no una constraint
-- única incondicional: la regla de negocio real no es "un candidato nunca
-- puede volver a aplicar", es "no debe poder tener más de una aplicación
-- ACTIVA al mismo tiempo". Si una aplicación anterior terminó en
-- 'rejected', el candidato debe poder volver a aplicar sin límite de
-- tiempo artificial -- no hay ninguna razón de negocio documentada para
-- bloquear a alguien que fue rechazado hace mucho. Para cualquier otro
-- estado (step1_completed, step2_completed, step3_completed, approved)
-- sí se bloquea un duplicado, porque esos representan una aplicación en
-- curso o ya resuelta positivamente.
--
-- Por qué NO se implementó una ventana de tiempo tipo "últimos 30 días"
-- (como sugería la auditoría a modo de ejemplo): un índice único de
-- Postgres no puede expresar una condición relativa a now() en su
-- predicado (el predicado de un índice debe ser inmutable). Implementar
-- una ventana de tiempo real requeriría un trigger o un cron de limpieza
-- periódica, complejidad adicional no justificada para un hallazgo de
-- prioridad moderada -- bloquear por estado activo/no-rechazado logra el
-- mismo objetivo de negocio (evitar duplicados activos) de forma más
-- simple, sin ventana arbitraria, y 100% atómico.
--
-- Por qué se usa `lower(trim(email))` y `regexp_replace(phone, '\D', '',
-- 'g')` en vez de las columnas crudas: candidate-step1-service.ts NO
-- normaliza email/phone antes de insertar (step1-validator.ts solo los
-- valida, no los reescribe) -- dos envíos legítimamente duplicados
-- podrían diferir en mayúsculas/espacios de email (" Foo@Bar.com " vs
-- "foo@bar.com") o en formato de teléfono ("604-555-0123" vs
-- "6045550123"). Comparar la forma normalizada (mismo criterio de
-- limpieza de dígitos que PHONE_DIGITS_PATTERN/cleanPhoneDigits en
-- step1-validator.ts) evita duplicados que técnicamente pasarían un
-- chequeo ingenuo sobre el valor crudo. regexp_replace/lower/trim son
-- funciones IMMUTABLE de Postgres, válidas en un índice de expresión.

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_email_unique_active
  ON candidates (lower(trim(email)))
  WHERE status <> 'rejected';

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_phone_unique_active
  ON candidates (regexp_replace(phone, '\D', '', 'g'))
  WHERE status <> 'rejected';

COMMENT ON INDEX idx_candidates_email_unique_active IS
  'v0.4.1 flujo de contratación: evita más de una aplicación activa '
  '(status <> rejected) por email normalizado. Fix de auditoría externa '
  '(hallazgo de duplicados, ver 297).';

COMMENT ON INDEX idx_candidates_phone_unique_active IS
  'v0.4.1 flujo de contratación: evita más de una aplicación activa '
  '(status <> rejected) por teléfono normalizado (solo dígitos). Fix de '
  'auditoría externa (hallazgo de duplicados, ver 297).';
