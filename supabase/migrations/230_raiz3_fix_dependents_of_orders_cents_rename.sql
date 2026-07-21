-- RAÍZ-3 (continuación de 229) — ajustar los objetos de base de datos que
-- dependían de los NOMBRES o UNIDADES antiguas de las columnas monetarias
-- de `orders` renombradas en la migración 229.
--
-- 1) Trigger de blindaje de columnas (RAÍZ-1, migración 214):
--    prevent_client_order_column_tampering() tiene una lista blanca de
--    columnas que un cliente autenticado puede tocar directamente:
--    ARRAY['wallet_amount_used', 'updated_at']. Esa columna ya no existe
--    (se renombró a wallet_amount_used_cents) -- sin este fix, la lista
--    blanca quedaría apuntando a un nombre inexistente y CUALQUIER cambio
--    a wallet_amount_used_cents por parte del cliente (la única escritura
--    legítima de sesión de cliente sobre `orders`, ver client/wallet/apply)
--    sería rechazado por el trigger como si fuera manipulación no
--    autorizada. Se reemplaza CREATE OR REPLACE FUNCTION igual que el
--    original (no se puede "renombrar" un literal dentro del cuerpo de una
--    función ya creada).
CREATE OR REPLACE FUNCTION public.prevent_client_order_column_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_cols text[] := ARRAY['wallet_amount_used_cents', 'updated_at'];
  old_j jsonb;
  new_j jsonb;
  k text;
BEGIN
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

COMMENT ON FUNCTION public.prevent_client_order_column_tampering() IS
  'RAÍZ-1 (auditoría 2026-07-21), actualizado en RAÍZ-3 (migración 230) tras el rename de wallet_amount_used a wallet_amount_used_cents: restringe qué columnas de orders puede '
  'escribir una sesión de cliente (rol authenticated) bajo la política '
  '"Users update own orders". Server-side (service_role) no está sujeto '
  'a esta restricción. Ver docs/vigente/INFORME_LOGICA_NEGOCIO_ROLES_2026-07-21.md §2.1 y §2.3.';

-- 2) orders_client_view (migración 056): Postgres propaga automáticamente
--    el rename de columna de la tabla base a esta vista (no requiere
--    CREATE OR REPLACE) -- su columna de salida ya se llama hold_amount_cents/
--    wallet_amount_used_cents/total_paid_cents tras la migración 229. Solo
--    se actualiza el comentario para que quede documentado sin ambigüedad.
COMMENT ON VIEW orders_client_view IS
  'v8.3 E1: proyección de solo lectura de orders para contexto CLIENTE. '
  'Excluye a propósito admin_review_*, stripe_* (ids técnicos), *_attempts, '
  '*_last_error, paypal_refund_*, qbo_export_status. '
  'RAÍZ-3 (2026-07-21, migración 229): hold_amount_cents/wallet_amount_used_cents/'
  'total_paid_cents están en CENTAVOS ENTEROS, no dólares (Postgres propagó el rename '
  'de columna automáticamente; este comentario documenta la unidad nueva). '
  'Debe reflejar src/lib/client-visible-columns.ts.';

-- 3) order_payment_summary (migración 027): esta vista mezclaba
--    o.hold_amount (antes dólares enteros) con q.total (quotes.total,
--    dólares con decimales) en la misma expresión aritmética
--    (remaining_amount = ROUND(q.total) - hold_amount). Tras el rename, la
--    columna subyacente pasó a centavos sin que la vista lo supiera --
--    Postgres solo actualiza el NOMBRE, no reinterpreta la expresión. Se
--    reconstruye la vista para que remaining_amount siga siendo una resta
--    de incidencia real: se expresa TODO en centavos (quote_total
--    convertido con ROUND(q.total * 100)), documentando el cambio de
--    unidad de salida (antes dólares, ahora centavos) porque ningún código
--    del repo consulta esta vista hoy (grep confirmado, 2026-07-21) -- no
--    hay call site que romper, pero se deja correcta para el primer
--    consumidor futuro.
--
--    Fix (detectado en `supabase db reset` real, 2026-07-21): Postgres
--    rechaza `CREATE OR REPLACE VIEW` cuando cambia el NOMBRE de una
--    columna de salida ya existente en su misma posición ("cannot change
--    name of view column", SQLSTATE 42P16) -- solo permite AÑADIR columnas
--    al final, nunca renombrar las que ya estaban (hold_amount ->
--    hold_amount_cents, remaining_amount -> remaining_amount_cents son
--    ambos renombres de columnas existentes). Como no hay consumidores
--    reales de esta vista (verificado por grep), se hace DROP + CREATE en
--    vez de CREATE OR REPLACE -- no hay nada que se rompa por el DROP.
DROP VIEW IF EXISTS order_payment_summary;

CREATE VIEW order_payment_summary AS
SELECT
  o.id,
  o.user_id,
  o.quote_id,
  o.service_date,
  o.service_datetime,
  o.status,
  o.payment_option,
  o.hold_amount_cents,
  o.hold_authorized_amount_cents,
  o.stripe_hold_payment_intent_id,
  o.stripe_capture_payment_intent_id,
  o.capture_authorized_amount,
  o.stripe_customer_id,
  o.stripe_payment_method_id,
  q.total AS quote_total,
  GREATEST(0, ROUND(q.total * 100)::INTEGER - COALESCE(o.hold_amount_cents, 0)) AS remaining_amount_cents
FROM orders o
JOIN quotes q ON q.id = o.quote_id;

COMMENT ON VIEW order_payment_summary IS
  'Vista determinista de órdenes con totales para cron jobs (migración 027). '
  'RAÍZ-3 (2026-07-21, migración 230): remaining_amount se renombró a '
  'remaining_amount_cents y su cálculo ahora opera enteramente en centavos '
  '(antes mezclaba hold_amount en dólares con quotes.total en dólares de forma '
  'correcta solo porque ambos operandos coincidían en unidad -- tras el rename '
  'de RAÍZ-3, quotes.total sigue en dólares y hold_amount_cents ya está en '
  'centavos, así que quote_total se escala x100 antes de restar). Sin '
  'consumidores en src/ al momento de esta migración (verificado por grep).';
