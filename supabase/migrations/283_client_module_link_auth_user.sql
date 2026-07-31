-- Módulo de Cliente -- vínculo con auth.users. Hasta ahora `clients` (269)
-- no tenía ningún vínculo con la identidad de Supabase Auth ya existente en
-- producción (Google/Apple OAuth + email/phone OTP, ver
-- src/components/cotizador/AuthModal.tsx) -- era intencional mientras el
-- módulo de cliente se construía de forma aislada. Esta migración agrega
-- ESE vínculo de forma puramente aditiva: una columna nullable +
-- un índice único parcial. No migra datos existentes, no toca
-- `client_profiles` (la tabla que ya usa AuthModal.tsx para el flujo de
-- cotizador/checkout) ni ninguna relación de cuentas/propiedades -- unificar
-- `client_profiles` con `clients` es una decisión de producto aparte, fuera
-- de alcance aquí.
--
-- Por qué `auth_user_id` es NULLABLE (no NOT NULL): `clients` también se
-- crea desde RRHH/ops (ver createClient() en client-service.ts) para
-- clientes que todavía no tienen (o nunca tendrán) una cuenta de usuario en
-- el sitio -- ej. un cliente comercial dado de alta por teléfono. Forzar
-- NOT NULL rompería ese flujo ya existente.
--
-- Por qué el índice es UNIQUE ... WHERE auth_user_id IS NOT NULL (índice
-- parcial) y no un UNIQUE constraint plano: un UNIQUE constraint normal en
-- Postgres ya trata múltiples NULL como no-conflictivos entre sí (NULL no
-- es igual a NULL), así que en teoría un UNIQUE constraint simple
-- funcionaría igual -- pero se usa el índice parcial explícito por
-- claridad de intención (documenta que el caso NULL es esperado y
-- frecuente, no un accidente) y porque es el mismo patrón que Postgres
-- recomienda cuando la semántica real es "único entre los que tienen
-- valor". Un auth_user_id SÍ debe ser único (una cuenta de auth == a lo
-- sumo un `clients` -- ver ensureClientForAuthUser() en
-- client-service.ts, que depende de este índice como red de seguridad
-- real contra duplicados en condiciones de carrera).
--
-- ON DELETE CASCADE: si se elimina el usuario de auth.users (ej. baja de
-- cuenta), el registro de `clients` ligado a esa cuenta se elimina con él.
-- Distinto del criterio usado en otras tablas de este módulo (ej.
-- client_communications.related_invoice_id usa SET NULL, 280) porque ahí
-- el historial de comunicaciones tiene valor propio aunque se pierda el
-- vínculo; aquí, en cambio, si la cuenta de auth desaparece, ya no hay
-- forma de que ese `clients` vuelva a ser reclamado por nadie -- y si el
-- cliente tenía facturas/propiedades reales asociadas a su `clients.id`,
-- ese es un caso que requiere revisión manual de todos modos (fuera de
-- alcance de esta migración: no se agrega aquí ninguna lógica de retención
-- o anonimización).

ALTER TABLE clients
  ADD COLUMN auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX idx_clients_auth_user_id
  ON clients (auth_user_id)
  WHERE auth_user_id IS NOT NULL;
