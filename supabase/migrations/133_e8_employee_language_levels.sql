-- Migración 133 — v8.3 E8/E3 retrofit: nivel de fluidez por idioma del empleado
--
-- Contexto: C.3 pide `empleado (... idiomas con nivel ...)`, pero
-- `employees.languages` (migración 003) es un TEXT[] plano — sabemos QUÉ
-- idiomas habla un empleado, nunca CON QUÉ NIVEL. El match de idioma del
-- despacho (B.2.13, migración 044 + dispatch-scheduler) hoy exige solo
-- presencia del código de idioma en el array, sin distinguir un hablante
-- nativo de alguien con nivel básico — insuficiente para el mercado de
-- Richmond (40% chino) donde la calidad del match de comunicación importa.
--
-- Diseño: JSONB aditivo, NO reemplaza `languages` (para no romper el motor
-- de despacho ya construido y activo — otra sesión está tocando ese mismo
-- código en paralelo ahora mismo). `languages` sigue siendo la fuente de
-- verdad de "qué idiomas habla"; `language_levels` es metadata opcional de
-- "con qué nivel". Vacío/ausente = sin dato de nivel capturado todavía
-- (no bloquea nada, el match por presencia sigue funcionando igual).
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS language_levels JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN employees.language_levels IS
  'v8.3 C.3/E8: nivel de fluidez por idioma, ej. {"en":"native","zh":"fluent"}. Claves deben existir en employees.languages. Niveles válidos: basic | intermediate | fluent | native. Metadata aditiva -- no reemplaza employees.languages como fuente del match de despacho (B.2.13).';

-- Guardrail liviano: solo valida la FORMA (objeto JSON, no array/escalar).
-- La validación de niveles permitidos y de que las claves ⊆ languages vive
-- en la capa de aplicación (src/lib/employee-languages.ts), igual que el
-- resto de invariantes de negocio del proyecto (no se duplican en CHECK
-- constraints salvo que sean puramente estructurales).
ALTER TABLE employees
  ADD CONSTRAINT employees_language_levels_is_object
  CHECK (jsonb_typeof(language_levels) = 'object');
