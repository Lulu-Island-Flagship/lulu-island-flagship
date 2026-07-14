-- Migración 130 — v8.3 E4: reparto real de zonas por operario (D.7, criterio
-- de aceptación E4 #5)
--
-- Contexto (auditoría 13 julio 2026): src/lib/zone-reparto.ts ya existía con
-- la función pura assignZonesToOperators() y su regla dura ("nunca Cocina +
-- Baño a la misma persona si N>=2"), con tests unitarios pasando. Pero no
-- estaba conectada a NINGÚN flujo real: ni el checklist del líder, ni la API,
-- ni ninguna tabla la persistía. Un empleado veía y podía marcar TODAS las
-- zonas del servicio, sin importar cuántos operarios había ni el reparto
-- calculado. Esta migración agrega el lugar donde persistir el resultado.
--
-- zones: código de zona (sop_checklists.zone) asignado a este empleado para
-- esta orden específica. NULL = todavía no calculado, o el servicio tiene
-- N=1 (un solo operario hace todo, no aplica reparto).

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS zones TEXT[];

COMMENT ON COLUMN assignments.zones IS
  'v8.3 E4 (D.7): zonas del checklist asignadas a este empleado para esta '
  'orden, calculadas por src/lib/zone-reparto.ts (assignZonesToOperators) '
  'respetando la regla dura Cocina != Baño con N>=2. Se calcula una sola vez '
  'por orden (todas las filas de assignments de esa orden se llenan juntas) '
  'y no se recalcula salvo que se borren explícitamente. NULL = aún sin '
  'calcular, o N=1 (el único operario cubre todas las zonas, sin reparto).';
