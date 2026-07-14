-- v8.3 E0 — Segunda ronda de auditoría externa, punto #5 (mantenido tras
-- objeción y contra-réplica, 2026-07-11): la migración 125 le dio
-- INSERT/UPDATE/DELETE a `anon` sobre TODAS las tablas de public -- esto era
-- necesario para restaurar el acceso de `authenticated` (el bug real que
-- resolvía 125), pero de paso le dio a `anon` (cualquiera en internet, sin
-- sesión) privilegios de escritura que NO necesita en el 99% de las tablas.
-- Riesgo real señalado por el auditor externo, confirmado antes de aplicar:
-- si mañana se crea una tabla nueva y alguien olvida el ENABLE ROW LEVEL
-- SECURITY (ya pasó dos veces, ver migración 128), `anon` tendría acceso de
-- escritura total sin ningún filtro, por el GRANT global heredado de acá.
--
-- Verificado ANTES de escribir esto (no se aplica a ciegas): mapeo completo
-- de cada escritura real que hace `anon` hoy en el código --
-- src/app/api/analytics/event/route.ts es el único endpoint donde `anon`
-- escribe con una política RLS que efectivamente lo permite
-- (013_analytics_events_table.sql: "Allow anonymous inserts" ... TO anon).
-- src/app/api/client/review/route.ts usa la key de anon pero NINGUNA
-- política RLS en orders/client_reviews/sentiment_alerts permite escritura
-- sin `auth.uid()` -- es decir, RLS ya bloquea a `anon` ahí hoy, con o sin
-- este GRANT; estrechar el privilegio de tabla no cambia ese
-- comportamiento, solo cierra una puerta que ya estaba muerta.
--
-- Esto NO toca a `authenticated` ni `service_role` -- siguen exactamente
-- igual que en la migración 125. Solo `anon` se estrecha.

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;

-- Único caso real confirmado: analytics_events ya tiene su propia política
-- RLS "Allow anonymous inserts" que exige este GRANT de tabla como base
-- (mismo patrón de "GRANT + RLS" que toda la migración 125 documentó).
GRANT INSERT ON TABLE analytics_events TO anon;
