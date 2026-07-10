-- Migración 104 — v8.3 E4: peso de zona (D.7) capturado y propagado al reparto
--
-- Contexto (auditoría sesión L): el plan D.7 dice que la tabla de zonas y
-- pesos es "EDITABLE por el admin — agregar zona = nombre + peso + tiempo
-- estimado, y aparece automáticamente en cotización, reparto y checklist
-- PWA". Se verificó AdminChecklistsClient.tsx, la tabla sop_checklists y las
-- rutas /api/admin/checklists: el campo peso/dificultad NO EXISTÍA en ningún
-- lado (ni columna, ni formulario, ni tipo) — no era un caso de "captura sin
-- propagar", el campo faltaba por completo. Esta migración lo agrega.
--
-- Alcance real de "peso" según D.7: NO determina N (el tamaño de equipo se
-- calcula por HHE en pricing.ts / calculateTeamRequirements, D.4 — eso ya
-- funciona y no se toca). El peso gobierna el REPARTO de zonas entre los N
-- operarios ya asignados ("sumar pesos ÷ N, balancear... nunca Cocina + Baño
-- a la misma persona si N≥2"). Por eso se consume en
-- src/lib/zone-reparto.ts (dispatch-team, no pricing) — documentado ahí.

ALTER TABLE sop_checklists
  ADD COLUMN IF NOT EXISTS zone_weight NUMERIC(4,2) NOT NULL DEFAULT 1.0;

COMMENT ON COLUMN sop_checklists.zone_weight IS
  'v8.3 E4 (D.7): peso/dificultad de la zona, editable por el admin. Se usa '
  'en src/lib/zone-reparto.ts (assignZonesToOperators) para repartir zonas '
  'entre los N operarios de un equipo, balanceando por peso y respetando la '
  'regla dura Cocina != Baño con la misma persona si N>=2. NO afecta el '
  'cálculo de N (eso sigue siendo HHE, D.4, sin cambios).';

-- Pesos por defecto de la tabla D.7 para las zonas ya sembradas por código
-- (zone), no por label — el código es estable entre subtipos de servicio.
UPDATE sop_checklists SET zone_weight = 3.0 WHERE zone = 'kitchen';
UPDATE sop_checklists SET zone_weight = 3.0 WHERE zone = 'bathroom';
UPDATE sop_checklists SET zone_weight = 2.0 WHERE zone = 'living';
UPDATE sop_checklists SET zone_weight = 1.5 WHERE zone = 'bedroom';
-- 'floor' y 'windows' no están en la tabla D.7 explícita (son sub-pasos del
-- protocolo, no zonas de reparto independientes); quedan en el default 1.0
-- hasta que el admin las edite explícitamente desde el panel.
