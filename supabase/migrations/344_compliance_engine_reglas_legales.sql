-- Migración 344 — v8.3 Capa 2 Financial Core: Compliance Engine (reglas_legales)
--
-- Tabla source-of-truth versionado para TODAS las reglas legales del sistema:
-- tasas impositivas, deducciones, parámetros laborales y obligaciones
-- regulatorias aplicables en BC / Canadá.
--
-- REGLA DE ORO (enforced por RLS + app-level policy):
--   NUNCA se edita una versión VIGENTE. Los cambios generan nueva versión.
--   Los asientos históricos quedan ligados a la versión de su momento.
--
-- RLS policy summary:
--   SELECT   → authenticated users (lectura pública de tasas vigentes)
--   INSERT   → solo admin vía service_role (app-level RBAC)
--   UPDATE   → solo admin vía service_role (app-level RBAC)
--   DELETE   → BLOQUEADO (nunca se borra; solo se archiva vía archiveRule)

-- ---------------------------------------------------------------------------
-- Tabla principal
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reglas_legales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiccion TEXT NOT NULL CHECK (jurisdiccion IN ('Federal', 'BC')),
  tipo TEXT NOT NULL CHECK (tipo IN (
    'CPP', 'EI', 'Tax', 'GST', 'PST',
    'WorkSafeBC', 'MinWage', 'VacationPay', 'StatutoryHolidays'
  )),
  version TEXT NOT NULL CHECK (version ~ '^\d{4}-\d{2}$'),  -- YYYY-MM
  parametros JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado TEXT NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'PENDIENTE', 'HISTORICO')),
  vigente_desde TIMESTAMPTZ,
  vigente_hasta TIMESTAMPTZ,
  creado_por TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  notas TEXT
);

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

-- Queries principales: "dame la regla VIGENTE de tipo X para la fecha Y"
CREATE INDEX idx_reglas_legales_tipo_vigente_desde
  ON reglas_legales (tipo, vigente_desde);

-- Búsqueda por jurisdicción + tipo (admin panel)
CREATE INDEX idx_reglas_legales_jurisdiccion_tipo
  ON reglas_legales (jurisdiccion, tipo);

-- Búsqueda por estado (filtro admin)
CREATE INDEX idx_reglas_legales_estado
  ON reglas_legales (estado);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE reglas_legales ENABLE ROW LEVEL SECURITY;

-- POLICY: SELECT — cualquier usuario autenticado puede leer las reglas.
-- Esto permite que el resolver del frontend / SSR lea tasas vigentes sin
-- exponer datos a usuarios anónimos.
CREATE POLICY "Authenticated users can read legal rules"
  ON reglas_legales FOR SELECT
  USING (auth.role() = 'authenticated');

-- POLICY: INSERT — solo admin vía service_role.
-- Las operaciones de escritura pasan por getServiceRoleClient() en
-- src/lib/admin.ts y src/lib/compliance-admin.ts, que bypassea RLS.
-- El policy USING (false) explícito documenta que NADIE con el cliente
-- anon puede insertar.
CREATE POLICY "Only admins via service_role can insert legal rules"
  ON reglas_legales FOR INSERT
  WITH CHECK (false);

-- POLICY: UPDATE — solo admin vía service_role.
-- Mismo patrón: las mutaciones vienen de API routes autenticadas con
-- requireAdminRole() que usan getServiceRoleClient().
CREATE POLICY "Only admins via service_role can update legal rules"
  ON reglas_legales FOR UPDATE
  USING (false) WITH CHECK (false);

-- POLICY: DELETE — BLOQUEADO para todos.
-- NUNCA se borra una regla. El ciclo de vida es VIGENTE → HISTORICO
-- vía archiveRule(). Mantener el historial completo es obligatorio
-- para auditoría y para ligar asientos contables a la versión de su momento.
CREATE POLICY "No one can delete legal rules — archive only"
  ON reglas_legales FOR DELETE
  USING (false);

-- ---------------------------------------------------------------------------
-- Seed data: BC 2026 — tasas y parámetros legales vigentes
-- ---------------------------------------------------------------------------

-- CPP 2026 — Canada Pension Plan
INSERT INTO reglas_legales (jurisdiccion, tipo, version, parametros, estado, vigente_desde, creado_por, notas) VALUES
('Federal', 'CPP', '2026-01',
 '{"tasa_empleado": 0.0595, "tope": 68500, "exencion_basica": 3500}',
 'VIGENTE', '2026-01-01T00:00:00.000Z',
 'seed-migration-344',
 'Tasas CPP 2026. YMPE=$68,500. El empleador iguala la contribución 1:1.');

-- EI 2026 — Employment Insurance
INSERT INTO reglas_legales (jurisdiccion, tipo, version, parametros, estado, vigente_desde, creado_por, notas) VALUES
('Federal', 'EI', '2026-01',
 '{"tasa_empleado": 0.0163, "tope": 66000, "tasa_employer": 1.4}',
 'VIGENTE', '2026-01-01T00:00:00.000Z',
 'seed-migration-344',
 'Tasas EI 2026. Máximo asegurable=$66,000. Empleador paga 1.4× la prima del empleado.');

-- BC Tax 2026 — impuesto provincial base
INSERT INTO reglas_legales (jurisdiccion, tipo, version, parametros, estado, vigente_desde, creado_por, notas) VALUES
('BC', 'Tax', '2026-01',
 '{"tasa_base": 0.0506}',
 'VIGENTE', '2026-01-01T00:00:00.000Z',
 'seed-migration-344',
 'Tasa base BC income tax 2026 (primer bracket). Retención completa requiere TD1 y PDOC de CRA.');

-- GST 2026 — Goods and Services Tax federal
INSERT INTO reglas_legales (jurisdiccion, tipo, version, parametros, estado, vigente_desde, creado_por, notas) VALUES
('Federal', 'GST', '2026-01',
 '{"tasa": 0.05}',
 'VIGENTE', '2026-01-01T00:00:00.000Z',
 'seed-migration-344',
 'GST federal 5%. Registrarse ante CRA si ingresos > $30,000 en 4 trimestres consecutivos.');

-- PST BC 2026 — Provincial Sales Tax
INSERT INTO reglas_legales (jurisdiccion, tipo, version, parametros, estado, vigente_desde, creado_por, notas) VALUES
('BC', 'PST', '2026-01',
 '{"tasa": 0.07}',
 'VIGENTE', '2026-01-01T00:00:00.000Z',
 'seed-migration-344',
 'PST BC 7%. Aplica a la mayoría de bienes y servicios salvo exenciones específicas.');

-- WorkSafeBC 2026 — clasificación limpieza (cleaning services)
INSERT INTO reglas_legales (jurisdiccion, tipo, version, parametros, estado, vigente_desde, creado_por, notas) VALUES
('BC', 'WorkSafeBC', '2026-01',
 '{"class_rate": 2.15, "class_code": "12345"}',
 'VIGENTE', '2026-01-01T00:00:00.000Z',
 'seed-migration-344',
 'WorkSafeBC classification unit para limpieza. $2.15 por cada $100 de nómina asegurable. Solo empleador.');

-- Salario Mínimo BC — vigente desde junio 2025
INSERT INTO reglas_legales (jurisdiccion, tipo, version, parametros, estado, vigente_desde, creado_por, notas) VALUES
('BC', 'MinWage', '2025-06',
 '{"hourly_rate": 17.40, "effective_date": "2025-06-01"}',
 'VIGENTE', '2025-06-01T00:00:00.000Z',
 'seed-migration-344',
 'Salario mínimo BC vigente desde junio 2025. $17.40/hora. Revisar cada junio por aumento anual.');

-- Vacation Pay — BC ESA Parte 7 s.58
INSERT INTO reglas_legales (jurisdiccion, tipo, version, parametros, estado, vigente_desde, creado_por, notas) VALUES
('BC', 'VacationPay', '2026-01',
 '{"rate_under_5y": 0.04, "rate_5y_plus": 0.06}',
 'VIGENTE', '2026-01-01T00:00:00.000Z',
 'seed-migration-344',
 'Vacation Pay BC ESA: 4% con <5 años de antigüedad, 6% con ≥5 años. Se acumula sobre gross pay.');

-- Statutory Holidays BC — 11 días (BC ESA Parte 5)
INSERT INTO reglas_legales (jurisdiccion, tipo, version, parametros, estado, vigente_desde, creado_por, notas) VALUES
('BC', 'StatutoryHolidays', '2026-01',
 '{"total_days": 11, "jurisdiction": "BC", "pay_rule": "average_day_pay: salario total ganado en 30 días anteriores ÷ días trabajados. Si trabaja el festivo: 1.5× horas trabajadas + average day''s pay. Elegibilidad: ≥30 días calendario empleado Y trabajó ≥15 de los 30 días anteriores."}',
 'VIGENTE', '2026-01-01T00:00:00.000Z',
 'seed-migration-344',
 '11 festivos estatutarios BC (incluye National Day for Truth and Reconciliation, agregado 2023).');
