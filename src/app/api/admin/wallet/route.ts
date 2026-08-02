import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { isValidUuid } from "@/lib/validation";
import {
  computeWalletCreditExpiryDate,
  computeExpiredUnusedAmount,
  computeAvailableWalletBalance,
  isExpiringWalletCreditType,
  type WalletTransactionRecord,
  type WalletTransactionType,
} from "@/lib/wallet";

/**
 * GET  /api/admin/wallet?userId=... — saldo + historial de un cliente.
 * POST /api/admin/wallet — otorga crédito: { userId, type: 'credit'|'promo'|'refund', amountDollars, description, orderId? }
 *
 * v8.3 E2.10 — Billetera Lulu (client_wallets/wallet_transactions, migración
 * 025) existía sin ningún código que la usara. 'credit'/'promo' expiran a
 * los 12 meses (wallet.ts); 'refund' no expira (es dinero que ya era del
 * cliente, ej. resolución de disputa). 'debit'/'payout' no se otorgan desde
 * aquí -- salen del gasto real del cliente o de un pago a tercero.
 *
 * Recurso RBAC: 'finance' (solo owner_admin) -- otorgar dinero a un cliente
 * es una decisión financiera, misma sensibilidad que pricing_settings.
 */
const GRANTABLE_TYPES: WalletTransactionType[] = ["credit", "promo", "refund"];

// Fix auditoría externa 2026-07-24: POST /api/admin/wallet otorgaba crédito
// sin límite máximo por operación y sin ninguna protección de idempotencia.
// La migración 233 (fix Kimi-C1, 2026-07-21) ya había dejado anotado este
// hueco como "riesgo residual documentado (fuera de alcance de ese fix)":
// apply_wallet_delta() cierra el vector de tocar la wallet de OTRO usuario,
// pero no valida montos ni deduplica llamadas legítimas repetidas del mismo
// admin -- un doble clic en el botón "otorgar crédito", o un retry de red
// del navegador/proxy, ejecuta el POST dos veces y duplica el crédito. Cada
// llamada crea una fila nueva en wallet_transactions (solo tiene índices
// normales por wallet_id/user_id/order_id, ningún UNIQUE que prevenga esto)
// y el RPC con SELECT...FOR UPDATE resuelve condiciones de carrera entre
// llamadas CONCURRENTES pero no compara contra transacciones recientes
// idénticas, así que dos llamadas secuenciales (una tras otra, no en
// paralelo) se procesan ambas sin problema.
//
// Fix de hoy, dos capas:
//   1) Límite máximo por operación individual (ver MAX_GRANT_AMOUNT_CENTS
//      abajo) -- ninguna otra parte del código tenía ya una convención de
//      límite para créditos de wallet (grep en src/lib/wallet*.ts y
//      cron/*), así que se fija uno nuevo, conservador: $500 CAD. Si un
//      caso real necesita otorgar más, el admin hace varias operaciones --
//      la fricción es intencional para un movimiento de dinero de este
//      tamaño, no un descuido a "arreglar" subiendo el límite.
//   2) Ventana corta de idempotencia: antes de llamar al RPC, se busca en
//      wallet_transactions una fila para la MISMA wallet + mismo type +
//      mismo amount + misma description, insertada en los últimos 10
//      segundos. Si existe, se rechaza con 409 en vez de insertar de
//      nuevo. No se usa una idempotency-key explícita del cliente (que
//      exigiría tocar el frontend y agregar una columna UNIQUE nueva vía
//      migración) porque el caso real a cerrar es el doble clic / retry de
//      red -- ambos repiten el mismo payload exacto en una ventana de
//      segundos, así que comparar contra la transacción más reciente ya
//      guardada es suficiente y no requiere rediseñar el schema.
const MAX_GRANT_AMOUNT_CENTS = 50_000; // $500.00 CAD por operación individual
const IDEMPOTENCY_WINDOW_SECONDS = 10;

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId es obligatorio" }, { status: 400 });
  }
  if (!isValidUuid(userId)) {
    return NextResponse.json({ error: "userId inválido" }, { status: 400 });
  }

  const { data: wallet, error: walletError } = await auth.supabase
    .from("client_wallets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (walletError) {
    console.error("admin/wallet error:", walletError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!wallet) {
    return NextResponse.json({ wallet: null, transactions: [], availableBalance: 0 }, { status: 200 });
  }

  const { data: transactions, error: txError } = await auth.supabase
    .from("wallet_transactions")
    .select("id, type, amount, balance_after, description, expires_at, created_at")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (txError) {
    console.error("admin/wallet error:", txError);
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
  const availableBalance = computeAvailableWalletBalance(wallet.balance, expiredUnusedAmount);

  return NextResponse.json(
    { wallet, transactions: transactions || [], availableBalance, expiredUnusedAmount },
    { status: 200 }
  );
}

interface GrantBody {
  userId?: string;
  type?: WalletTransactionType;
  amountDollars?: number;
  description?: string;
  orderId?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  let body: GrantBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.userId) {
    return NextResponse.json({ error: "userId es obligatorio" }, { status: 400 });
  }
  if (!isValidUuid(body.userId)) {
    return NextResponse.json({ error: "userId inválido" }, { status: 400 });
  }
  if (body.orderId !== undefined && body.orderId !== null && body.orderId !== "" && !isValidUuid(body.orderId)) {
    return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
  }
  if (!body.type || !GRANTABLE_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `type debe ser uno de: ${GRANTABLE_TYPES.join(", ")}` }, { status: 400 });
  }
  const amountDollars = Number(body.amountDollars);
  if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
    return NextResponse.json({ error: "amountDollars debe ser > 0" }, { status: 400 });
  }
  const amountCents = Math.round(amountDollars * 100);

  // Fix auditoría externa 2026-07-24 (ver comentario junto a
  // MAX_GRANT_AMOUNT_CENTS arriba): límite máximo por operación individual.
  if (amountCents > MAX_GRANT_AMOUNT_CENTS) {
    return NextResponse.json(
      {
        error: `amountDollars no puede superar $${(MAX_GRANT_AMOUNT_CENTS / 100).toFixed(2)} CAD por operación. Para montos mayores, hazlo en varias operaciones.`,
      },
      { status: 400 }
    );
  }

  const { data: wallet, error: walletError } = await supabase
    .from("client_wallets")
    .select("id")
    .eq("user_id", body.userId)
    .maybeSingle();
  if (walletError) {
    console.error("admin/wallet error:", walletError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!wallet) {
    return NextResponse.json({ error: "Este cliente no tiene billetera (sin client_profiles activo)" }, { status: 404 });
  }

  const trimmedDescription = body.description?.trim() || null;

  // Fix auditoría externa 2026-07-24 (ver comentario junto a
  // IDEMPOTENCY_WINDOW_SECONDS arriba): chequeo de ventana corta contra
  // doble clic / retry de red -- rechaza si ya existe una fila idéntica
  // (misma wallet, mismo type, mismo amount, misma description) insertada
  // en los últimos IDEMPOTENCY_WINDOW_SECONDS segundos.
  const idempotencyWindowStartIso = new Date(Date.now() - IDEMPOTENCY_WINDOW_SECONDS * 1000).toISOString();
  let recentDuplicateQuery = supabase
    .from("wallet_transactions")
    .select("id")
    .eq("wallet_id", wallet.id)
    .eq("type", body.type)
    .eq("amount", amountCents)
    .gte("created_at", idempotencyWindowStartIso)
    .limit(1);
  recentDuplicateQuery = trimmedDescription
    ? recentDuplicateQuery.eq("description", trimmedDescription)
    : recentDuplicateQuery.is("description", null);
  const { data: recentDuplicate, error: recentDuplicateError } = await recentDuplicateQuery.maybeSingle();
  if (recentDuplicateError) {
    console.error("admin/wallet error:", recentDuplicateError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (recentDuplicate) {
    return NextResponse.json(
      { error: "Ya se procesó una operación idéntica hace instantes, evita el doble clic" },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  const expiresAt = isExpiringWalletCreditType(body.type) ? computeWalletCreditExpiryDate(nowIso) : null;

  // Fix (auditoría de seguridad externa 2026-08-01, migración 301): además
  // del chequeo de ventana de 10s de arriba (best-effort, a nivel de app),
  // se pasa un request_id real al RPC -- wallet_transactions tiene ahora un
  // UNIQUE parcial en (wallet_id, request_id) (migración 301), así que dos
  // llamadas con el mismo request_id nunca insertan dos filas, ni siquiera
  // bajo una carrera real entre dos requests concurrentes (algo que el
  // chequeo "leer los últimos N segundos" de arriba no puede garantizar por
  // sí solo). El request_id se deriva determinísticamente del admin que
  // ejecuta la acción + wallet + type + amount + description + un bucket de
  // tiempo del mismo tamaño que IDEMPOTENCY_WINDOW_SECONDS, para que un
  // doble clic/retry dentro de esa ventana calcule EXACTAMENTE el mismo
  // request_id sin depender de que el frontend genere y reenvíe una
  // idempotency key explícita.
  const idempotencyBucket = Math.floor(Date.now() / (IDEMPOTENCY_WINDOW_SECONDS * 1000));
  const requestId = createHash("sha256")
    .update(
      [auth.user.id, wallet.id, body.type, amountCents, trimmedDescription ?? "", idempotencyBucket].join("|")
    )
    .digest("hex");

  // v8.3 fix (auditoría 2026-07-15): mutación atómica vía RPC (migración 180)
  // en vez de leer balance + calcular en JS + UPDATE sin bloqueo -- ese
  // patrón permitía "lost updates" si dos operaciones tocaban la misma
  // billetera casi al mismo tiempo (ver comentario de la función SQL).
  const { data: rpcResult, error: rpcError } = await supabase.rpc("apply_wallet_delta", {
    p_wallet_id: wallet.id,
    p_user_id: body.userId,
    p_order_id: body.orderId || null,
    p_type: body.type,
    p_delta: amountCents,
    p_description: trimmedDescription,
    p_expires_at: expiresAt,
    p_request_id: requestId,
  });
  if (rpcError) {
    console.error("admin/wallet error:", rpcError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  const newBalance = rpcResult?.[0]?.new_balance ?? null;
  const transactionId = rpcResult?.[0]?.transaction_id ?? null;

  return NextResponse.json({ transactionId, newBalance }, { status: 201 });
}
