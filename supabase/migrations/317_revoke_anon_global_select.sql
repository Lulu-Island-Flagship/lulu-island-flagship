-- Fix auditoría de seguridad externa (2026-08-02): `anon` tenía GRANT SELECT
-- en TODAS las tablas de public (191/191), incluyendo employees, clients,
-- payroll_entries, client_payment_methods, wallet_transactions, etc.
-- Verificación en producción (eadgocbmfnqfpgvoutvp) vía
-- information_schema.role_table_grants: anon aparece con privilege_type
-- SELECT en cada tabla del schema public sin excepción. Esto es el
-- comportamiento por defecto que deja Supabase al crear el schema `public`
-- (GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated) y
-- nunca se revocó selectivamente.
--
-- En la práctica, para casi todas las tablas esto queda neutralizado por
-- RLS: las políticas existentes (auditadas vía pg_policies) filtran por
-- auth.uid(), que es NULL para una request sin sesión (anon key pura), así
-- que devuelven 0 filas. Pero es defensa en profundidad rota: cualquier
-- tabla nueva creada sin política de SELECT explícita, o cualquier política
-- futura mal escrita (ej. `USING (true)` por error, o un rol que no valide
-- auth.uid() correctamente), quedaría inmediatamente expuesta a lectura
-- anónima porque el GRANT de nivel SQL ya lo permite. El principio correcto
-- es "deny by default" en ambas capas (GRANT y RLS), no solo en RLS.
--
-- Verificación (pg_policies, 2026-08-02) de qué tablas tienen una política
-- que de verdad permite lectura a `anon` sin sesión (qual sin auth.uid()):
--   - feature_flags        (qual: true)
--   - pricing_rules        (qual: is_active = true)
--   - capacity_slots       (qual: is_published = true OR is_supervisor(...))
--   - live_portfolio_candidates (qual: status = 'approved' AND
--                            anonymization_status = 'processed')
--   - legal_texts          (qual: is_active = true)
--   - positions            (qual: is_public = true)
-- Estas 6 tablas son las que el producto expone deliberadamente a
-- visitantes sin sesión (landing pages de reclutamiento, checklist de
-- feature flags del cliente web, calendario de disponibilidad público,
-- portafolio de trabajos anonimizado, textos legales activos, vacantes
-- públicas). Todas las demás tablas de public NO tienen ninguna política
-- que permita lectura sin auth.uid() -- se revoca el GRANT de SELECT a
-- anon en ellas.
--
-- No se toca `authenticated`: las políticas RLS existentes ya son las que
-- deciden qué puede leer un usuario con sesión, y restringir el GRANT de
-- `authenticated` tabla por tabla duplicaría esa lógica sin necesidad.
--
-- Auditoría de ALTER DEFAULT PRIVILEGES: se revoca también a nivel de
-- default privileges para que cualquier tabla NUEVA creada por el rol
-- `postgres` (dueño de las migraciones) no vuelva a heredar SELECT público
-- para anon automáticamente -- cada tabla nueva deberá otorgar SELECT a
-- anon explícitamente si de verdad necesita ser pública.

REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;

GRANT SELECT ON TABLE public.feature_flags TO anon;
GRANT SELECT ON TABLE public.pricing_rules TO anon;
GRANT SELECT ON TABLE public.capacity_slots TO anon;
GRANT SELECT ON TABLE public.live_portfolio_candidates TO anon;
GRANT SELECT ON TABLE public.legal_texts TO anon;
GRANT SELECT ON TABLE public.positions TO anon;

COMMENT ON TABLE public.feature_flags IS
  'Fix auditoría de seguridad externa (migración 317, 2026-08-02): anon SELECT '
  'revocado a nivel global y re-otorgado explícitamente solo aquí -- la política '
  '"Public read feature flags" (qual: true) hace de esta tabla una excepción '
  'intencional de lectura pública.';
COMMENT ON TABLE public.pricing_rules IS
  'Fix auditoría de seguridad externa (migración 317, 2026-08-02): anon SELECT '
  'revocado a nivel global y re-otorgado explícitamente solo aquí -- la política '
  '"Public read active pricing rules" expone tarifas activas a visitantes sin sesión '
  'por diseño (cotizador público).';
COMMENT ON TABLE public.capacity_slots IS
  'Fix auditoría de seguridad externa (migración 317, 2026-08-02): anon SELECT '
  'revocado a nivel global y re-otorgado explícitamente solo aquí -- la política '
  '"Public read published capacity slots" expone huecos de agenda publicados a '
  'visitantes sin sesión por diseño (calendario de reservas público).';
COMMENT ON TABLE public.live_portfolio_candidates IS
  'Fix auditoría de seguridad externa (migración 317, 2026-08-02): anon SELECT '
  'revocado a nivel global y re-otorgado explícitamente solo aquí -- la política '
  '"Public reads approved processed portfolio" expone trabajos ya anonimizados y '
  'aprobados por diseño (portafolio de marketing público).';
COMMENT ON TABLE public.legal_texts IS
  'Fix auditoría de seguridad externa (migración 317, 2026-08-02): anon SELECT '
  'revocado a nivel global y re-otorgado explícitamente solo aquí -- la política '
  '"legal_texts public read active" expone textos legales vigentes (TOS, privacidad) '
  'a visitantes sin sesión por diseño.';
COMMENT ON TABLE public.positions IS
  'Fix auditoría de seguridad externa (migración 317, 2026-08-02): anon SELECT '
  'revocado a nivel global y re-otorgado explícitamente solo aquí -- la política '
  '"positions public read public" expone vacantes marcadas is_public=true a '
  'visitantes sin sesión por diseño (página de reclutamiento).';
