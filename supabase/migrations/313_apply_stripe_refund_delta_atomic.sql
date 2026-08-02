-- Migración 313 (auditoría externa de integridad financiera, 2026-08-02)
--
-- Contexto: src/app/api/stripe/webhook/route.ts, handleRefund() -- procesa el
-- evento `charge.refunded`. Ya está deduplicado por stripe_event_id (misma
-- entrega de un MISMO evento nunca se procesa dos veces, ver
-- stripe_webhook_events UNIQUE + fix B-P2-4). Pero DOS reembolsos parciales
-- DISTINTOS y legítimos sobre la MISMA orden (dos eventos `charge.refunded`
-- diferentes, cada uno con su propio stripe_event_id) SÍ pueden llegar como
-- dos invocaciones HTTP concurrentes de este webhook -- Stripe no garantiza
-- entrega serializada. El código anterior era:
--   1. SELECT orders (total_paid_cents, card_amount_charged_cents,
--      stripe_amount_refunded_cents)
--   2. Calcular deltaCents = nuevo_acumulado - previamente_conocido (en JS)
--   3. UPDATE orders con los nuevos totales (en JS, sin WHERE optimista)
-- Dos invocaciones concurrentes de handleRefund para la misma orden pueden
-- ambas leer el mismo `previousRefundedCents` en el paso 1 antes de que
-- cualquiera escriba en el paso 3 -- "lost update": la segunda escritura
-- pisa a la primera con un cálculo basado en un estado ya obsoleto,
-- perdiendo la resta de uno de los dos reembolsos reales.
--
-- Esta función mueve las 3 operaciones a una sola transacción SQL con
-- `SELECT ... FOR UPDATE` sobre la fila de la orden -- la segunda invocación
-- concurrente se bloquea hasta que la primera termine su transacción, y
-- entonces relee el acumulado YA actualizado por la primera, calculando su
-- propio delta correctamente en vez de basarse en un estado obsoleto.
-- El INSERT en shadow_ledger_entries usa ON CONFLICT DO NOTHING sobre
-- idempotency_key (igual que el resto del código de este módulo) para que
-- un reintento nunca duplique la entrada de ledger.

create or replace function public.apply_stripe_refund_delta_atomic(
  p_payment_intent_id text,
  p_charge_id text,
  p_cumulative_refunded_cents integer
)
returns table (
  success boolean,
  delta_cents integer,
  order_id uuid,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_previous_refunded_cents integer;
  v_delta_cents integer;
  v_new_total_paid_cents integer;
  v_new_card_charged_cents integer;
begin
  select o.id, o.user_id, o.total_paid_cents, o.card_amount_charged_cents,
         o.stripe_amount_refunded_cents, o.warranty_status
    into v_order
    from public.orders o
   where o.stripe_hold_payment_intent_id = p_payment_intent_id
      or o.stripe_capture_payment_intent_id = p_payment_intent_id
   order by o.created_at asc
   limit 1
   for update;

  if not found then
    return query select false, 0, null::uuid, 'order_not_found';
    return;
  end if;

  v_previous_refunded_cents := coalesce(v_order.stripe_amount_refunded_cents, 0);
  v_delta_cents := p_cumulative_refunded_cents - v_previous_refunded_cents;

  if v_delta_cents <= 0 then
    -- Evento repetido/fuera de orden respecto al acumulado ya registrado
    -- (posible tras el lock si otra transacción concurrente ya aplicó un
    -- acumulado igual o mayor) -- nada nuevo que restar.
    return query select false, 0, v_order.id, 'no_new_refund';
    return;
  end if;

  v_new_total_paid_cents := greatest(0, coalesce(v_order.total_paid_cents, 0) - v_delta_cents);
  v_new_card_charged_cents := greatest(0, coalesce(v_order.card_amount_charged_cents, 0) - v_delta_cents);

  update public.orders
     set total_paid_cents = v_new_total_paid_cents,
         card_amount_charged_cents = v_new_card_charged_cents,
         stripe_amount_refunded_cents = p_cumulative_refunded_cents,
         warranty_status = case when v_new_total_paid_cents = 0 then 'resolved_client' else v_order.warranty_status end,
         updated_at = now()
   where id = v_order.id;

  insert into public.shadow_ledger_entries (
    event_type, order_id, user_id, amount_cents, currency,
    payment_processor, external_reference, idempotency_key,
    occurred_at, sync_status, metadata
  )
  values (
    'warranty_refund',
    v_order.id,
    v_order.user_id,
    v_delta_cents,
    'cad',
    'stripe',
    p_charge_id || ':' || p_cumulative_refunded_cents::text,
    'warranty_refund:' || (p_charge_id || ':' || p_cumulative_refunded_cents::text),
    now(),
    'pending_qbo_sync',
    jsonb_build_object('payment_intent_id', p_payment_intent_id, 'charge_id', p_charge_id)
  )
  on conflict (idempotency_key) do nothing;

  return query select true, v_delta_cents, v_order.id, 'applied';
end;
$$;

comment on function public.apply_stripe_refund_delta_atomic is
  'Auditoría 2026-08-02: aplica atómicamente (con row lock) el delta de un reembolso de Stripe (charge.refunded) a orders.total_paid_cents/card_amount_charged_cents/stripe_amount_refunded_cents + registro en shadow_ledger_entries, cerrando la carrera entre dos eventos charge.refunded concurrentes para la misma orden. Ver src/app/api/stripe/webhook/route.ts::handleRefund.';

revoke all on function public.apply_stripe_refund_delta_atomic(text, text, integer) from public, anon, authenticated;
