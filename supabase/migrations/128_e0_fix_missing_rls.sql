-- v8.3 E0 — Tercera ronda de auditoría externa (verificada, 2026-07-11):
-- de las ~92 tablas del esquema public, dos NUNCA tuvieron
-- ENABLE ROW LEVEL SECURITY: stripe_webhook_events y hhe_settings. Como la
-- migración 125 le dio GRANT SELECT/INSERT/UPDATE/DELETE a anon/authenticated
-- sobre TODAS las tablas de public (comportamiento por defecto de Supabase),
-- estas dos quedaron completamente abiertas -- cualquiera, autenticado o no,
-- podía leer y escribir sin ningún filtro.
--
-- stripe_webhook_events: solo la toca src/app/api/stripe/webhook/route.ts
-- usando la service_role key (que ignora RLS por diseño). No hay ningún caso
-- de uso legítimo para que anon/authenticated la lean o escriban -- deny-all
-- total para esos dos roles es la política correcta.
--
-- hhe_settings: solo se consulta directo desde
-- src/app/api/admin/hhe-settings/route.ts y hhe-adjustments/route.ts, ambos
-- ya protegidos por requireAdminRole(). El flujo de cotización pública pasa
-- por la función SECURITY DEFINER get_current_hhe_table(), que no depende de
-- RLS. Se le da exactamente el mismo patrón que pricing_settings/
-- payroll_settings (mismo tipo de tabla de configuración): solo supervisores
-- pueden leer o escribir directamente.

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
-- Deliberadamente sin políticas para anon/authenticated: default-deny total.
-- service_role sigue teniendo acceso porque ese rol ignora RLS.

ALTER TABLE hhe_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Supervisors read hhe settings" ON hhe_settings
  FOR SELECT USING (is_supervisor(auth.uid()));

CREATE POLICY "Supervisors manage hhe settings" ON hhe_settings
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));
