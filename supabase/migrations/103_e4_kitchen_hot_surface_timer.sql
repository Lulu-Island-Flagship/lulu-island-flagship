-- Migración 103 — v8.3 E4: timer de superficie caliente en cocina (D.7)
--
-- Contexto (auditoría sesión L): el plan D.7 exige, en el protocolo de la
-- zona COCINA, que estufa/campana (código azul) tengan "superficie caliente:
-- esperar 10 min, timer en PWA" y el criterio de aceptación E4 exige que ese
-- timer "exista y BLOQUEE la tarea". Se verificó con grep sobre src/ que no
-- existía ningún timer de cocina en el repo; el único patrón de timer de 10
-- min ya construido y testeado era isChemicalAlertTimerExpired (wellbeing.ts)
-- y evaluateSafetyAbortEscalation (safety-abort.ts), ninguno aplicado a esto.
--
-- Diseño: se reutiliza sop_checklists.items (JSONB, ya existe desde
-- 006_modulo4_checklist_tables.sql) agregando el flag `hotSurface: true` a
-- los ítems reales de estufa/campana de las zonas de cocina ya sembradas.
-- Se agrega una sola columna nueva en service_checklist_items para registrar
-- cuándo el empleado inició el temporizador de ese ítem para ese servicio.

ALTER TABLE service_checklist_items
  ADD COLUMN IF NOT EXISTS hot_surface_timer_started_at TIMESTAMPTZ;

COMMENT ON COLUMN service_checklist_items.hot_surface_timer_started_at IS
  'v8.3 E4 (D.7): momento en que el empleado inició el temporizador de 10 min '
  'de superficie caliente para este ítem (estufa/campana). NULL = no iniciado '
  '(la tarea permanece bloqueada). isKitchenTimerExpired() en '
  'src/lib/kitchen-timer.ts decide si ya venció.';

-- Marca los ítems existentes de estufa/campana en las zonas de cocina ya
-- sembradas (first_time, regular, move_in_out — 006_modulo4_checklist_tables.sql)
-- como `hotSurface: true` dentro del JSONB de items. Coincide por texto del
-- label (no hay ID estable compartido entre subtipos de servicio); es
-- additivo y no rompe items que ya tengan otros campos.
UPDATE sop_checklists
SET items = (
  SELECT jsonb_agg(
    CASE
      WHEN (item->>'label') ILIKE '%estufa%' OR (item->>'label') ILIKE '%campana%'
        THEN item || jsonb_build_object('hotSurface', true)
      ELSE item
    END
  )
  FROM jsonb_array_elements(items) AS item
)
WHERE zone = 'kitchen';
