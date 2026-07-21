-- v8.3 fix E-B5 (auditoría RBAC/compliance 2026-07-21), parte 1/2
--
-- HALLAZGO: el derecho de eliminación PIPEDA solo hacía soft-delete de UNA
-- tabla (`client_profiles`), dejando intactos `orders`, `quotes` (con
-- `consent_ip`), `profiles`, `client_properties`, `communication_log` y
-- `entity_notes`. `communication_log` no tenía columna `deleted_at` -- no
-- existía forma de marcarla como "borrada" sin violar `trg_prevent_delete`
-- (DELETE físico bloqueado a propósito, migración 045). Se añade la columna
-- para que el endpoint PATCH /api/admin/pipeda/requests/[id] pueda incluirla
-- en la cascada de soft-delete (ver ese archivo para el resto del fix).
--
-- `wallet_transactions` deliberadamente NO se toca aquí: es Grupo B
-- (inmutable financiero, migración 039) sin `deleted_at` por diseño --
-- registro contable que debe sobrevivir para reconciliación/CRA
-- independientemente del derecho de borrado PIPEDA. Igual que los perfiles,
-- el borrado real de datos personales de un cliente con contabilidad viva
-- es, ante todo, una decisión legal/fiscal (retención de 6 años CRA vs. 2
-- años de este módulo), no solo técnica -- se documenta como límite de
-- alcance explícito, no se simula un borrado que no ocurre.

ALTER TABLE communication_log ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_comm_log_not_deleted ON communication_log(user_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN communication_log.deleted_at IS
  'v8.3 fix E-B5: soft-delete para cumplir el derecho de eliminación PIPEDA sin violar trg_prevent_delete (DELETE físico sigue bloqueado).';
