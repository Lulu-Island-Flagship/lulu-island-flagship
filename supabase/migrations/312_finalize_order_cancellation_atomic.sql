-- Migración 312 (auditoría externa de integridad financiera, 2026-08-02)
--
-- Contexto: src/app/api/orders/[orderId]/cancel/route.ts ya hace CAS de
-- orders.status a 'cancelled' ANTES de tocar Stripe (fix Kimi-C5, migración
-- previa) -- eso ya resuelve la carrera de doble-cancelación. Pero DESPUÉS
-- de las llamadas reales a Stripe (captura de penalidad / reembolso wallet,
-- que sí pueden fallar a mitad de camino y ya movieron dinero real), el
-- endpoint hacía 3 escrituras de BD separadas y sin comprobar error en la
-- primera:
--   1. UPDATE orders (total_paid_cents, card_amount_charged_cents,
--      wallet_refunded_amount_cents, paypal_refund_required/status) -- sin
--      chequear `error`.
--   2. INSERT shadow_ledger_entries (wallet_refund) -- en un try/catch que
--      solo loguea.
--   3. INSERT shadow_ledger_entries (cancellation_penalty) -- ídem.
--
-- Si Stripe ya cobró/reembolsó pero cualquiera de estas 3 escrituras falla
-- (ej. error transitorio de red hacia Supabase), el dinero real ya se movió
-- pero orders/shadow_ledger_entries queda inconsistente, sin ninguna señal
-- clara de qué exactamente no se pudo persistir.
--
-- Esta función agrupa las 3 escrituras en una sola transacción atómica (el
-- cuerpo de una función plpgsql es una transacción implícita): o las 3
-- quedan persistidas, o ninguna. shadow_ledger_entries.idempotency_key es
-- UNIQUE (migración 081) -- los INSERT usan ON CONFLICT DO NOTHING para que
-- un reintento del caller tras un fallo parcial nunca duplique una entrada
-- de ledger ya escrita.
--
-- El caller (route.ts) sigue siendo responsable de: 1) hacer el CAS de
-- status ANTES de esta función, 2) ejecutar las llamadas reales a
-- Stripe/PayPal ANTES de esta función, y 3) SOLO llamar a esta función si
-- esas llamadas externas ya tuvieron éxito (o no aplicaban). Si esta
-- función falla, el caller debe loguear un error CRÍTICO para reconciliación
-- manual -- el dinero externo ya se movió y no se debe reintentar el cargo
-- desde cero.

create or replace function public.finalize_order_cancellation(
  p_order_id uuid,
  p_hold_released_at timestamptz,
  p_hold_captured_at timestamptz,
  p_total_paid_cents integer,
  p_card_amount_charged_cents integer,
  p_wallet_refunded_amount_cents integer,
  p_paypal_refund_required boolean,
  p_paypal_refund_status text,
  p_wallet_refund_entry jsonb default null,
  p_penalty_entry jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
  set
    hold_released_at = p_hold_released_at,
    hold_captured_at = p_hold_captured_at,
    total_paid_cents = p_total_paid_cents,
    card_amount_charged_cents = p_card_amount_charged_cents,
    wallet_refunded_amount_cents = p_wallet_refunded_amount_cents,
    paypal_refund_required = p_paypal_refund_required,
    paypal_refund_status = p_paypal_refund_status,
    capture_last_error = null,
    updated_at = now()
  where id = p_order_id;

  if not found then
    raise exception 'finalize_order_cancellation: order % not found', p_order_id;
  end if;

  if p_wallet_refund_entry is not null then
    insert into public.shadow_ledger_entries (
      event_type, order_id, user_id, amount_cents, currency,
      payment_processor, external_reference, idempotency_key,
      occurred_at, sync_status, metadata
    )
    values (
      p_wallet_refund_entry->>'event_type',
      (p_wallet_refund_entry->>'order_id')::uuid,
      (p_wallet_refund_entry->>'user_id')::uuid,
      (p_wallet_refund_entry->>'amount_cents')::integer,
      coalesce(p_wallet_refund_entry->>'currency', 'cad'),
      p_wallet_refund_entry->>'payment_processor',
      p_wallet_refund_entry->>'external_reference',
      p_wallet_refund_entry->>'idempotency_key',
      (p_wallet_refund_entry->>'occurred_at')::timestamptz,
      coalesce(p_wallet_refund_entry->>'sync_status', 'pending_qbo_sync'),
      coalesce(p_wallet_refund_entry->'metadata', '{}'::jsonb)
    )
    on conflict (idempotency_key) do nothing;
  end if;

  if p_penalty_entry is not null then
    insert into public.shadow_ledger_entries (
      event_type, order_id, user_id, amount_cents, currency,
      payment_processor, external_reference, idempotency_key,
      occurred_at, sync_status, metadata
    )
    values (
      p_penalty_entry->>'event_type',
      (p_penalty_entry->>'order_id')::uuid,
      (p_penalty_entry->>'user_id')::uuid,
      (p_penalty_entry->>'amount_cents')::integer,
      coalesce(p_penalty_entry->>'currency', 'cad'),
      p_penalty_entry->>'payment_processor',
      p_penalty_entry->>'external_reference',
      p_penalty_entry->>'idempotency_key',
      (p_penalty_entry->>'occurred_at')::timestamptz,
      coalesce(p_penalty_entry->>'sync_status', 'pending_qbo_sync'),
      coalesce(p_penalty_entry->'metadata', '{}'::jsonb)
    )
    on conflict (idempotency_key) do nothing;
  end if;
end;
$$;

comment on function public.finalize_order_cancellation is
  'Auditoría 2026-08-02: persiste atómicamente el resultado de una cancelación de orden (UPDATE orders + hasta 2 INSERT en shadow_ledger_entries) DESPUÉS de que las llamadas externas a Stripe ya tuvieron éxito. Ver src/app/api/orders/[orderId]/cancel/route.ts.';

-- Solo el service role (bypass RLS) invoca esta función -- mismo patrón de
-- acceso que el resto de shadow_ledger_entries (081) y las demás RPC de
-- dinero de este proyecto (ej. apply_wallet_delta, 180).
revoke all on function public.finalize_order_cancellation(uuid, timestamptz, timestamptz, integer, integer, integer, boolean, text, jsonb, jsonb) from public, anon, authenticated;
