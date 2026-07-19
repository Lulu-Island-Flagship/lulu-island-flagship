-- Migración 186 — v8.3 E11 (auditoría 2026-07-18): duplicación de esquema
-- en neighbor_leads.
--
-- La migración 050 creó `neighbor_leads` (contacted_at, converted_to_quote_id).
-- La migración 148 intentó crear una versión distinta de `neighbor_leads`
-- (con `converted_to_client BOOLEAN`) usando CREATE TABLE IF NOT EXISTS --
-- pero como la tabla ya existía desde 050, ese CREATE TABLE fue un no-op
-- completo (IF NOT EXISTS se evalúa sobre la tabla entera, no columna por
-- columna) y `converted_to_client` nunca se agregó al esquema real. El
-- código en src/app/api/admin/neighborhood/route.ts (log_lead) solo escribe
-- las columnas de 050; esta migración agrega la columna que 148 pretendía
-- crear, sin tocar las columnas existentes de 050.

ALTER TABLE neighbor_leads
  ADD COLUMN IF NOT EXISTS converted_to_client BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN neighbor_leads.converted_to_client IS
  'v8.3 (2026-07-18): agregada por migración 186 -- la migración 148 pretendía crearla pero su CREATE TABLE IF NOT EXISTS fue un no-op porque neighbor_leads ya existía desde la migración 050. Complementa converted_to_quote_id (050): un lead puede convertirse en cotización (converted_to_quote_id) y, más adelante, en cliente activo (converted_to_client).';
