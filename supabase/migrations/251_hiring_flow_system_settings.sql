-- v0.4.1 (flujo de contratación / candidate hiring flow) -- módulo nuevo,
-- aún no integrado con nada existente en el repo (se integrará después,
-- a mano, con cuidado). Esta migración solo crea la tabla base
-- `system_settings`: un almacén clave/valor genérico para parámetros de
-- configuración del flujo de contratación (plazos, límites de archivo,
-- montos fiscales, etc.) que necesitan poder cambiarse sin deploy.
--
-- Por qué TEXT y no columnas tipadas: distintos settings tienen distintos
-- tipos (string, number, boolean, json) y no vale la pena una tabla por
-- tipo ni un esquema EAV más elaborado para este alcance. `value` se
-- guarda SIEMPRE como texto plano; el parseo/tipado fuerte (Number(),
-- JSON.parse(), etc. según `value_type`) lo hace el servicio TS que lea
-- esta tabla, no la base de datos. `value_type` existe para que ese
-- servicio sepa cómo interpretar cada fila sin adivinar.
--
-- Por qué RLS `USING (false) WITH CHECK (false)`: mismo patrón ya usado en
-- el repo para tablas admin-only (ver comentario de cabecera en
-- src/lib/admin.ts, v8.3 E11 -- financial_stress_scenario_runs,
-- legacy_migration_checklist_items, gbp_checklist_items, etc.). Ninguna
-- política permite acceso directo vía el cliente anon/authenticated de
-- Supabase: todas las lecturas y escrituras de configuración pasan por
-- rutas de API que usan getServiceRoleClient() (src/lib/admin.ts), el cual
-- bypassea RLS explícitamente después de que requireAdminRole() ya validó
-- el rol. `is_public` es un flag de negocio para que el servicio TS decida
-- qué settings puede exponer un endpoint público (ej. textos legales,
-- nombre de la empresa) -- NO abre una policy de RLS pública; el propio
-- endpoint filtra por is_public = true antes de responder.

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_system_settings_is_public
  ON system_settings (is_public);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Sin policies permisivas: todo acceso (lectura y escritura) pasa por API
-- con service role (mismo patrón que getServiceRoleClient() en
-- src/lib/admin.ts). No hay política pública ni siquiera para is_public =
-- true: el filtrado de qué es "público" ocurre en el endpoint TS, no en
-- Postgres, porque el criterio de "público" es de negocio (ej. combinar
-- is_public con otras reglas) y no queremos acoplar la RLS a esa lógica.
DROP POLICY IF EXISTS "system_settings no direct access" ON system_settings;
CREATE POLICY "system_settings no direct access" ON system_settings
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE system_settings IS
  'v0.4.1 flujo de contratación: almacén clave/valor de configuración. '
  'value siempre es texto plano; el tipado fuerte (según value_type) lo '
  'hace el servicio TS, no la DB. Acceso exclusivo vía API con service '
  'role -- RLS bloquea todo acceso directo (USING/CHECK false).';
