-- RAÍZ-1 (auditoría 2026-07-21, INFORME_LOGICA_NEGOCIO_ROLES_2026-07-21.md §2.1)
--
-- HALLAZGO: la política "Users update own orders" (migración 019) permite
-- FOR UPDATE USING/WITH CHECK (auth.uid() = user_id) sin ninguna
-- restricción de columna. Cualquier cliente autenticado puede, con la
-- anon key pública + su propia sesión, hacer:
--
--   supabase.from('orders').update({ status: 'completed', total_paid: 0 })
--                           .eq('id', suPropiaOrden)
--
-- y desbloquear -- sin haber recibido servicio -- el trigger de QC, el
-- cron de crédito de referido ($30+$30), reclamos de garantía, rebook,
-- NPS, churn, galería, y el token de encuesta pre-reseña que acredita
-- $10 de billetera (client/pre-review-survey/route.ts).
--
-- VERIFICACIÓN (2026-07-21, agente consolidador): se auditó cada ruta bajo
-- src/app/api/client/** que hace `.from("orders").update(...)`. Resultado:
--   - client/review/route.ts        -> usa SERVICE ROLE (token de un solo
--                                      uso, no sesión), solo toca
--                                      review_token_used_at. No afectado
--                                      por RLS.
--   - client/wallet/apply/route.ts  -> ÚNICA ruta que actualiza `orders`
--                                      con la sesión del cliente (RLS
--                                      aplica). Solo toca
--                                      wallet_amount_used y updated_at.
-- Ninguna otra ruta de cliente actualiza `orders` con sesión de usuario.
--
-- FIX: no se retira la política (rompería wallet/apply, el único caso
-- legítimo). Se añade un trigger BEFORE UPDATE que, cuando quien ejecuta
-- el UPDATE es el rol `authenticated` (sesión de cliente, no
-- service_role ni el rol de migraciones), rechaza cualquier cambio a una
-- columna que no esté en la lista blanca. Es agnóstico a qué columnas
-- existan hoy o se agreguen mañana: compara OLD vs NEW como jsonb y solo
-- permite diferencias en las columnas explícitamente listadas.

CREATE OR REPLACE FUNCTION public.prevent_client_order_column_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Columnas que un cliente autenticado (rol `authenticated`, sesión propia,
  -- fila con auth.uid() = user_id ya garantizado por la policy) puede
  -- modificar directamente vía UPDATE. Todo lo demás pasa exclusivamente
  -- por rutas server-side con SUPABASE_SERVICE_ROLE_KEY.
  allowed_cols text[] := ARRAY['wallet_amount_used', 'updated_at'];
  old_j jsonb;
  new_j jsonb;
  k text;
BEGIN
  -- El backend (crons, rutas /api/admin, /api/orders/[id]/cancel,
  -- stripe/confirm, webhooks) opera con SUPABASE_SERVICE_ROLE_KEY, que en
  -- Supabase conecta como el rol de Postgres `service_role`. Ese rol tiene
  -- BYPASSRLS y no debe quedar restringido por este trigger. `postgres` y
  -- `supabase_admin` cubren migraciones y operaciones administrativas del
  -- propio proyecto.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  old_j := to_jsonb(OLD);
  new_j := to_jsonb(NEW);

  FOR k IN SELECT jsonb_object_keys(old_j) LOOP
    IF k = ANY(allowed_cols) THEN
      CONTINUE;
    END IF;
    IF old_j -> k IS DISTINCT FROM new_j -> k THEN
      RAISE EXCEPTION
        'RAÍZ-1: la sesión de cliente no puede modificar la columna "%" de orders (order_id=%). '
        'Esta escritura debe hacerse desde una ruta server-side con clave de servicio.',
        k, OLD.id
        USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_order_column_tampering ON orders;
CREATE TRIGGER trg_prevent_client_order_column_tampering
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_client_order_column_tampering();

COMMENT ON FUNCTION public.prevent_client_order_column_tampering() IS
  'RAÍZ-1 (auditoría 2026-07-21): restringe qué columnas de orders puede '
  'escribir una sesión de cliente (rol authenticated) bajo la política '
  '"Users update own orders". Server-side (service_role) no está sujeto '
  'a esta restricción. Ver docs/vigente/INFORME_LOGICA_NEGOCIO_ROLES_2026-07-21.md §2.1.';
