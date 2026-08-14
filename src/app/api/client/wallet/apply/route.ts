
import { NextRequest, NextResponse } from "next/server";
import {
  computeExpiredUnusedAmount,
  computeAvailableWalletBalance,
  computeWalletApplication,
  type WalletTransactionRecord,
} from "@/lib/wallet";
import { isValidUuid } from "@/lib/validation";
import { requireClientCaller } from "@/lib/require-client-caller";
import { createRouteSupabaseClient } from "@/lib/supabase-server";

// Fix (auditoría externa, verificado 2026-07-31): antes, si faltaban las
// env vars de Supabase, se usaban placeholders en silencio (ver mismo fix
// en src/app/api/stripe/confirm/route.ts). Ahora se lanza un error claro.
function _getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurado");
  }
  return url;
}

function _getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado");
  }
  return key;
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
  const supabase = await createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
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
  if (!isValidUuid(body.orderId)) {
    return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, user_id, status, hold_captured_at, capture_captured_at, wallet_amount_used_cents, quote_id, quotes(total)")
    .eq("id", body.orderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (orderError) {
    console.error("orderError:", orderError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
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
  if (walletError) {
    console.error("walletError:", walletError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!wallet || wallet.balance <= 0) {
    return NextResponse.json({ error: "No hay saldo de billetera disponible." }, { status: 400 });
  }

  const { data: transactions, error: txError } = await supabase
    .from("wallet_transactions")
    .select("id, type, amount, expires_at, created_at")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (txError) {
    console.error("txError:", txError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
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

  // Fix (auditoría de integridad de datos 2026-08-01): antes esto era un
  // read-then-write de DOS pasos (débito de billetera vía apply_wallet_delta,
  // luego UPDATE aparte de orders.wallet_amount_used_cents) con reversión
  // manual compensatoria si el segundo paso fallaba. El problema real no era
  // solo la falta de atomicidad entre esos dos pasos -- era que ninguno de
  // los dos bloqueaba la fila de `orders`, así que el cron de Batch Capture
  // (7PM) podía capturar esta MISMA orden en la ventana entre la lectura del
  // pedido (arriba, líneas ~88-116) y esta escritura, cobrando el 100% por
  // tarjeta/PayPal sin ver el crédito de billetera todavía aplicado.
  //
  // Ahora es una sola llamada RPC (migración 307) que hace SELECT ... FOR
  // UPDATE sobre `orders` ANTES de aplicar el débito, revalida elegibilidad
  // bajo ese lock, aplica el débito de billetera y actualiza la orden -- todo
  // en una transacción atómica. Cualquier UPDATE concurrente sobre esta orden
  // (incluido el del batch capture) espera hasta que esta transacción hace
  // commit, cerrando la ventana de carrera por completo. Ya no se necesita
  // reversión manual: si algo falla a mitad de la función SQL, Postgres
  // revierte todo el bloque automáticamente.
  const { data: rpcResult, error: rpcError } = await supabase.rpc("apply_wallet_credit_to_order", {
    p_order_id: order.id,
    p_user_id: user.id,
    p_wallet_id: wallet.id,
    p_apply_cents: applyCents,
    p_description: `Aplicado a orden ${order.id}`,
  });

  if (rpcError) {
    console.error("client/wallet/apply error:", rpcError);
    const msg = rpcError.message || "";
    if (msg.includes("ORDER_NOT_FOUND")) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    }
    if (msg.includes("ORDER_NOT_CONFIRMED")) {
      return NextResponse.json({ error: "No se puede aplicar crédito a esta orden en su estado actual." }, { status: 400 });
    }
    if (msg.includes("ORDER_ALREADY_CAPTURED")) {
      return NextResponse.json({ error: "Esta orden ya fue cobrada; no se puede aplicar crédito ahora." }, { status: 400 });
    }
    if (msg.includes("WALLET_CREDIT_ALREADY_APPLIED")) {
      return NextResponse.json({ error: "Ya se aplicó crédito de billetera a esta orden." }, { status: 400 });
    }
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const result = rpcResult?.[0];
  const newBalance = result?.new_balance ?? wallet.balance - applyCents;
  const updatedOrder = { id: result?.order_id ?? order.id, wallet_amount_used_cents: result?.wallet_amount_used_cents ?? applyCents };

  return NextResponse.json({ appliedCents: applyCents, newWalletBalance: newBalance, order: updatedOrder }, { status: 200 });
}
