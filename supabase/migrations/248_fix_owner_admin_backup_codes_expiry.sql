-- 248_fix_owner_admin_backup_codes_expiry.sql
--
-- Auditoría externa 2026-07-30 (BUG 2): owner_admin_backup_codes
-- (194_e0_owner_admin_backup_codes.sql) solo tenía used_at/revoked_at/
-- created_at -- ningún expires_at. Un set de códigos impreso hace un año
-- (ej. guardado en una caja fuerte física, "fuera de línea" a propósito,
-- ver comentario de diseño en 194) seguía siendo válido para siempre
-- mientras no se generara un set nuevo (que sí revoca el anterior). Eso es
-- una ventana de validez sin límite superior para el mecanismo de 2FA de
-- emergencia de la cuenta con más privilegios del sistema.
--
-- Fix: agrega expires_at (nullable a nivel de columna, pero el código de
-- generación en src/lib/backup-codes.ts / src/app/api/admin/backup-codes/
-- route.ts la puebla siempre a partir de ahora). Para las filas YA EXISTENTES
-- (generadas antes de este fix, sin expires_at) se les da un expires_at de
-- 90 días desde su created_at -- no se fuerza regeneración retroactiva
-- (decisión: no hay forma de re-emitir códigos nuevos sin invalidar los que
-- el owner_admin ya tiene impresos/guardados sin que él mismo lo sepa; darles
-- una ventana de 90 días desde su creación es equivalente a como si el fix
-- hubiera estado vigente desde siempre, y evita dejarlos válidos para
-- siempre en silencio).
--
-- 90 días elegido por consistencia con el resto de mecanismos de "código
-- temporal de seguridad de larga duración" del repo (ninguno usa más de 90
-- días) y porque backup codes están pensados para regenerarse periódicamente
-- de todos modos (el flujo de generación ya revoca el set anterior).

ALTER TABLE owner_admin_backup_codes
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill de filas existentes: 90 días desde created_at. No toca filas que
-- ya tengan expires_at (idempotente si esta migración corre más de una vez).
UPDATE owner_admin_backup_codes
SET expires_at = created_at + INTERVAL '90 days'
WHERE expires_at IS NULL;

COMMENT ON COLUMN owner_admin_backup_codes.expires_at IS
  'v8.3 fix 248 (auditoría 2026-07-30, BUG 2): expiración del código -- 90 días desde la generación (ver hashBackupCode/generateBackupCodeSet en src/lib/backup-codes.ts y POST /api/admin/backup-codes). Filas backfilleadas (generadas antes de este fix) reciben created_at + 90 días. La verificación (POST /api/admin/backup-codes/verify) rechaza códigos con expires_at en el pasado.';

-- Índice parcial que ya existía (idx_owner_admin_backup_codes_user, filtro
-- used_at IS NULL AND revoked_at IS NULL) sigue siendo válido tal cual --
-- expires_at es una condición adicional evaluada en la query de verificación,
-- no requiere cambiar el índice existente.
