-- v0.4.1 (flujo de contratación) -- fix de hallazgo de auditoría externa.
--
-- td1-service.ts (calculateTd1) usaba un fallback SILENCIOSO de $12,580
-- hardcodeado en TypeScript cuando faltaba el setting
-- tax_bc_basic_personal_amount en system_settings -- la migración 254
-- (seed inicial) sembró tax_year, tax_federal_basic_personal_amount y
-- payroll_min_wage_bc, pero se olvidó de este monto provincial de BC
-- (línea 1 de TD1BC). Un default fiscal desactualizado y silencioso podía
-- causar retenciones de impuestos mal calculadas sin que nadie lo notara.
--
-- Fix aplicado en dos partes:
--   1) td1-service.ts ya no usa getSettingOrDefault() con un placeholder
--      hardcodeado -- ahora usa getSetting() (sin default), que lanza
--      SettingNotFoundError si falta la key, igual que ya hace para
--      tax_year y tax_federal_basic_personal_amount.
--   2) Esta migración siembra el valor real (mismo placeholder $12,580 que
--      antes vivía en TS, ahora en la fuente correcta -- system_settings,
--      auditable/corregible vía set_system_setting() sin tocar código)
--      para que calculateTd1() siga funcionando mientras se verifica el
--      monto oficial contra CRA/BC antes de producción real.
--
-- Mismo criterio de idempotencia que 254: ON CONFLICT DO NOTHING, para no
-- pisar un valor que ya haya sido corregido en producción vía
-- set_system_setting() antes de que esta migración se aplique en ese
-- entorno.

INSERT INTO system_settings (key, value, value_type, description, is_public)
VALUES
  (
    'tax_bc_basic_personal_amount',
    '12580',
    'number',
    'Monto personal básico provincial de British Columbia (TD1BC línea 1, CAD) usado en cálculos de retención de impuestos para el año fiscal configurado. [ASSUMPTION -- valor placeholder, NO confirmado contra la fuente oficial de BC para el año fiscal vigente -- verificar contra fuente oficial antes de producción]',
    false
  )
ON CONFLICT (key) DO NOTHING;
