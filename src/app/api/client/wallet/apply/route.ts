import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  computeExpiredUnusedAmount,
  computeAvailableWalletBalance,
  computeWalletApplication,
  type WalletTransactionRecord,
} from "@/lib/wallet";

// Fix (auditoría externa, verificado 2026-07-31): antes, si faltaban las
// env vars de Supabase, se usaban placeholders en silencio (ver mismo fix
// en src/app/api/stripe/confirm/route.ts). Ahora se lanza un error claro.
function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurado");
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado");
  }
  return key;
}

// v8.3 fix (auditoría seguridad 2026-07-26): orderId solo se validaba como
// string no vacío, sin comprobar que fuera un UUID válido -- un valor
// arbitrario llegaba intacto hasta la consulta a `orders`.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options });
      },
    },
  });
}

/**
 * POST /api/client/wallet/apply — { orderId }
 *
 * v8.3 E2.10: aplica el saldo disponible de la billetera (créditos vigentes,
 * no vencidos) a una orden propia que AÚN no fue cobrada (hold_captured_at Y
 * capture_captured_at ambos null, status='confirmed'). El monto aplicado se
 * guarda en orders.wallet_amount_used_cents (RAÍZ-3, migración 229: CENTAVOS
 * ENTEROS, mismo formato que client_wallets/wallet_transactions -- antes de
 * esa migración esta ruta truncaba a dólares enteros al guardar, descuadrando
 * el ledger en cada uso, B-P0-5) y el Batch Capture de las 7PM lo resta del
 * total antes de calcular Hold/saldo (ver cron/batch-capture).
 *
 * No permite aplicar a una orden ya capturada -- el precio ya sellado (B.2.11)
 * no se reabre; si el cliente quiere usar su crédito, debe hacerlo ANTES del
 * cobro de las 7PM.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { orderId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.orderId || typeof body.orderId !== "string") {
    return NextResponse.json({ error: "orderId es obligatorio" }, { status: 400 });
  }
  if (!UUID_REGEX.test(body.orderId)) {
    return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, user_id, status, hold_captured_at, capture_captured_at, wallet_amount_used_cents, quote_id, quotes(total)")
    .eq("id", body.orderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

  // Fix (auditoría externa, verificado 2026-07-31): `status` se seleccionaba
  // pero NUNCA se validaba -- solo se chequeaba hold_captured_at/
  // capture_captured_at (ninguno de los dos se setea todavía en una orden
  // 'pending', 'cancelled' o 'no_show'), permitiendo aplicar/descontar
  // crédito real de billetera a una orden que nunca va a cobrarse. El
  // crédito quedaría atado a esa orden muerta (wallet_amount_used_cents) en
  // vez de disponible para una reserva real del cliente.
  if (order.status !== "confirmed") {
    return NextResponse.json(
      { error: `No se puede aplicar crédito a una orden en estado '${order.status}'.` },
      { status: 400 }
    );
  }

  if (order.hold_captured_at || order.capture_captured_at) {
    return NextResponse.json({ error: "Esta orden ya fue cobrada; no se puede aplicar crédito ahora." }, { status: 400 });
  }
  if (order.wallet_amount_used_cents && order.wallet_amount_used_cents > 0) {
    return NextResponse.json({ error: "Ya se aplicó crédito de billetera a esta orden." }, { status: 400 });
  }

  const { data: wallet, error: walletError } = await supabase
    .from("client_wallets")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (walletError) return NextResponse.json({ error: walletError.message }, { status: 500 });
  if (!wallet || wallet.balance <= 0) {
    return NextResponse.json({ error: "No hay saldo de billetera disponible." }, { status: 400 });
  }

  const { data: transactions, error: txError } = await supabase
    .from("wallet_transactions")
    .select("id, type, amount, expires_at, created_at")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

  const records: WalletTransactionRecord[] = (transactions || []).map((t) => ({
    id: t.id,
    type: t.type,
    amount: t.amount,
    createdAtIso: t.created_at,
    expiresAtIso: t.expires_at,
  }));
  const nowIso = new Date().toISOString();
  const expiredUnusedAmount = computeExpiredUnusedAmount(records, nowIso);
  const availableBalanceCents = computeAvailableWalletBalance(wallet.balance, expiredUnusedAmount);

  // Fix (auditoría externa, verificado 2026-07-31, hallazgo #21 -- el más
  // crítico y sutil de la lista): antes se asumía SIN VERIFICAR que
  // `order.quotes` del join `quotes(total)` siempre viene como ARRAY
  // (`?.[0]?.total`, mismo patrón usado en cron/batch-capture,
  // cron/hold-authorize, cron/no-show, admin/orders/[id]/force-full-capture
  // y otros). PostgREST puede devolver este embed como OBJETO o como ARRAY
  // según cómo esté resuelta la relación orders.quote_id -> quotes.id en el
  // esquema real (no hay FK declarada en las migraciones trackeadas para esa
  // columna, solo un UNIQUE -- la relación real puede haberse configurado
  // fuera de las migraciones versionadas). Si aquí realmente llegara como
  // objeto, `order.quotes?.[0]` sería SIEMPRE undefined, quoteTotalCents
  // sería SIEMPRE 0, y CUALQUIER intento de aplicar crédito de billetera
  // fallaría en silencio con "No hay saldo disponible para aplicar" (mensaje
  // engañoso -- el problema no sería el saldo, sería el total en 0).
  // Mismo patrón defensivo YA usado en este mismo módulo en la misma fecha
  // (ver src/app/api/client/orders/route.ts, normalización de
  // sop_checklists) -- se normaliza aquí explícitamente para funcionar
  // correctamente sin importar la forma real que devuelva Supabase, en vez
  // de asumir una de las dos a ciegas.
  const quotesJoin = order.quotes as { total: number | string } | { total: number | string }[] | null;
  const quoteRow = Array.isArray(quotesJoin) ? quotesJoin[0] : quotesJoin;
  const quoteTotalCents = Math.round(Number(quoteRow?.total ?? 0) * 100);
  const applyCents = computeWalletApplication(availableBalanceCents, quoteTotalCents);

  if (applyCents <= 0) {
    return NextResponse.json({ error: "No hay saldo disponible para aplicar (puede estar vencido)." }, { status: 400 });
  }

  // v8.3 fix (auditoría 2026-07-15): mutación atómica vía RPC (migración 180)
  // en vez de read-then-write sin bloqueo.
  const { data: rpcResult, error: rpcError } = await supabase.rpc("apply_wallet_delta", {
    p_wallet_id: wallet.id,
    p_user_id: user.id,
    p_order_id: order.id,
    p_type: "debit",
    p_delta: -applyCents,
    p_description: `Aplicado a orden ${order.id}`,
  });
  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 });
  const newBalance = rpcResult?.[0]?.new_balance ?? wallet.balance - applyCents;

  // RAÍZ-3 (2026-07-21, migración 229): wallet_amount_used_cents ya está en
  // centavos -- se guarda applyCents directo, sin dividir por 100. Antes esta
  // línea truncaba a dólares enteros (applyDollars = applyCents / 100) y
  // guardaba eso en una columna INTEGER dólares, perdiendo centavos y
  // descuadrando el ledger contra client_wallets/wallet_transactions (B-P0-5).
  const { data: updatedOrder, error: orderUpdateError } = await supabase
    .from("orders")
    .update({ wallet_amount_used_cents: applyCents, updated_at: nowIso })
    .eq("id", order.id)
    .select("id, wallet_amount_used_cents")
    .single();

  if (orderUpdateError) {
    // Fix (auditoría externa, verificado 2026-07-31): el débito de billetera
    // (apply_wallet_delta arriba) ya es real y atómico en este punto -- si
    // este UPDATE de `orders` fallara sin más, el cliente quedaría con el
    // saldo ya descontado pero la orden SIN reflejar el crédito aplicado
    // (wallet_amount_used_cents seguiría en su valor previo), así que el
    // Batch Capture de las 7PM le cobraría el 100% por tarjeta/PayPal de
    // todas formas -- crédito perdido + cobro completo, dinero real del
    // cliente perdido dos veces. Se revierte el débito (crédito de vuelta,
    // mismo RPC atómico) antes de responder con error, en vez de dejar el
    // wallet desincronizado de la orden.
    const { error: reversalError } = await supabase.rpc("apply_wallet_delta", {
      p_wallet_id: wallet.id,
      p_user_id: user.id,
      p_order_id: order.id,
      p_type: "credit",
      p_delta: applyCents,
      p_description: `Reversión automática: fallo al reflejar crédito en orden ${order.id}`,
    });
    if (reversalError) {
      console.error(
        `CRITICAL: wallet debit for order ${order.id} could not be reflected on the order AND the compensating reversal also failed. Manual reconciliation required. Debit RPC succeeded (${applyCents} cents), order update error:`,
        orderUpdateError,
        "reversal error:",
        reversalError
      );
    }
    return NextResponse.json({ error: orderUpdateError.message }, { status: 500 });
  }

  return NextResponse.json({ appliedCents: applyCents, newWalletBalance: newBalance, order: updatedOrder }, { status: 200 });
}
