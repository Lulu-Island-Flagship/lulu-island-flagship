-- ============================================================
-- E0 RETROFIT (continuación) — Criterio 2: Soft Delete Universal
-- (v8.3, invariante B.2.9)
--
-- La migración 001 creó la tabla profiles sin deleted_at, y la
-- migración 039 agregó la columna deleted_at y el trigger
-- trg_prevent_delete. Sin embargo, profiles quedó sin el trigger
-- de reescritura soft_delete_rewrite ni el índice parcial
-- WHERE deleted_at IS NULL, a diferencia del resto de tablas de
-- negocio que sí los tienen (ver 039 y 341).
--
-- Esta migración cierra esa brecha agregando:
--   1. deleted_at TIMESTAMPTZ (idempotente)
--   2. prevent_hard_delete  — bloquea DELETE físico
--   3. soft_delete_rewrite  — reescribe UPDATE de deleted_at a now()
--   4. Índice parcial WHERE deleted_at IS NULL
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columna deleted_at (idempotente: 039 ya la agregó)
-- ------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- 2. prevent_hard_delete: DELETE físico prohibido (bloqueo duro)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_prevent_delete ON profiles;
CREATE TRIGGER trg_prevent_delete
  BEFORE DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ------------------------------------------------------------
-- 3. soft_delete_rewrite: UPDATE de deleted_at forzado a now()
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_soft_delete ON profiles;
CREATE TRIGGER trg_soft_delete
  BEFORE UPDATE OF deleted_at ON profiles
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION soft_delete_rewrite();

-- ------------------------------------------------------------
-- 4. Índice parcial para consultas que filtran por no-eliminado
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at
  ON profiles(deleted_at) WHERE deleted_at IS NULL;
