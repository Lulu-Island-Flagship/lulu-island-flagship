import { NextResponse } from "next/server";

import { ORDER_CLIENT_COLUMNS } from "@/lib/client-visible-columns";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
import { computeAvailableWalletBalance, computeExpiredUnusedAmount, type WalletTransactionRecord } from "@/lib/wallet";
import { ensureClientForAuthUser } from "@/lib/client-module/client-service";
/**
 * GET /api/client/dashboard — agregación para el Dashboard de /cuenta.
 *
 * Devuelve en una sola llamada: perfil, próxima reserva, última completada,
 * wallet balance, y alertas. Evita que el cliente haga 3-4 requests paralelos.
 */
export async function GET() {
  const supabase = createRouteSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  // ── Perfil ──────────────────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const { data: clientProfile } = await supabase
    .from("client_profiles")
    .select("phone_verified, services_count")
    .eq("user_id", user.id)
    .maybeSingle();

  // ── Próxima reserva (la primera con fecha futura + status confirmado/pendiente) ──
  const today = new Date().toISOString().split("T")[0];
  const { data: upcomingOrders } = await supabase
    .from("orders")
    .select(
      `${ORDER_CLIENT_COLUMNS}, hold_captured_at, capture_captured_at, quotes:quote_id (service_category, service_subtype, service_type, address, zone, total)`
    )
    .eq("user_id", user.id)
    .in("status", ["pending", "confirmed"])
    .gte("service_date", today)
    .order("service_date", { ascending: true })
    .limit(1);

  const nextService = upcomingOrders && upcomingOrders.length > 0 ? upcomingOrders[0] : null;

  // ── Cleaner asignado a la próxima reserva ────────────────────────────────
  let assignedCleaner: { name: string; languages: string[] } | null = null;
  if (nextService) {
    const { data: assignment } = await supabase
      .from("assignments")
      .select("employee_id, employees:employee_id (name, languages)")
      .eq("order_id", nextService.id)
      .in("status", ["pending", "en_route", "arrived", "in_progress"])
      .order("assigned_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (assignment) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emp = (assignment as any).employees;
      const empData = Array.isArray(emp) ? emp[0] : emp;
      if (empData) {
        assignedCleaner = {
          name: empData.name ?? null,
          languages: empData.languages ?? [],
        };
      }
    }
  }

  // ── Última completada (para galería / rebook) ──
  const { data: lastCompleted } = await supabase
    .from("orders")
    .select(
      `id, service_date, status, quotes:quote_id (service_category, service_subtype, service_type, address, zone, total)`
    )
    .eq("user_id", user.id)
    .eq("status", "completed")
    .order("service_date", { ascending: false })
    .limit(1);

  const lastService = lastCompleted && lastCompleted.length > 0 ? lastCompleted[0] : null;

  // ── Wallet ──────────────────────────────────────────────────────────────
  const { data: wallet } = await supabase
    .from("client_wallets")
    .select("id, balance, currency")
    .eq("user_id", user.id)
    .maybeSingle();

  let walletBalanceCents = 0;
  let walletCurrency = "CAD";

  if (wallet) {
    const { data: transactions } = await supabase
      .from("wallet_transactions")
      .select("id, type, amount, created_at, expires_at")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: true });

    const txRecords: WalletTransactionRecord[] = (transactions || []).map((t) => ({
      id: t.id,
      type: t.type as WalletTransactionRecord["type"],
      amount: t.amount,
      createdAtIso: t.created_at,
      expiresAtIso: t.expires_at,
    }));

    const expiredUnused = computeExpiredUnusedAmount(txRecords, new Date().toISOString());
    walletBalanceCents = computeAvailableWalletBalance(wallet.balance, expiredUnused);
    walletCurrency = wallet.currency;
  }

  // ── Método de pago por defecto ───────────────────────────────────────────
  let defaultPaymentMethod: { lastFour: string; expiryMonth: number; expiryYear: number } | null = null;
  try {
    const { clientId } = await ensureClientForAuthUser(
      { authUserId: user.id, email: user.email ?? null, phone: user.phone ?? null },
      supabase
    );
    const { data: defaultMethod } = await supabase
      .from("client_payment_methods")
      .select("last_four, expiry_month, expiry_year")
      .eq("client_id", clientId)
      .eq("is_default", true)
      .eq("status", "active")
      .maybeSingle();
    if (defaultMethod) {
      defaultPaymentMethod = {
        lastFour: (defaultMethod as { last_four: string | null }).last_four ?? "----",
        expiryMonth: (defaultMethod as { expiry_month: number | null }).expiry_month ?? 0,
        expiryYear: (defaultMethod as { expiry_year: number | null }).expiry_year ?? 0,
      };
    }
  } catch {
    // Non-critical — si falla el bridge clients/auth, simplemente no mostramos la tarjeta
  }

  // ── Alertas ─────────────────────────────────────────────────────────────
  const alerts: string[] = [];

  if (clientProfile && !clientProfile.phone_verified) {
    alerts.push("phone_not_verified");
  }

  // ── Respuesta ───────────────────────────────────────────────────────────
  return NextResponse.json(
    {
      profile: {
        fullName: profile?.full_name ?? null,
        avatarUrl: profile?.avatar_url ?? null,
      },
      nextService: nextService
        ? {
            id: nextService.id,
            serviceDate: nextService.service_date,
            serviceTime: nextService.service_time,
            status: nextService.status,
            address: extractQuoteField(nextService, "address"),
            zone: extractQuoteField(nextService, "zone"),
            serviceType: extractQuoteField(nextService, "service_type"),
            serviceSubtype: extractQuoteField(nextService, "service_subtype"),
            total: extractQuoteField(nextService, "total"),
          }
        : null,
      lastService: lastService
        ? {
            id: lastService.id,
            serviceDate: lastService.service_date,
            address: extractQuoteField(lastService, "address"),
            serviceType: extractQuoteField(lastService, "service_type"),
            serviceSubtype: extractQuoteField(lastService, "service_subtype"),
          }
        : null,
      wallet: {
        balanceCents: walletBalanceCents,
        currency: walletCurrency,
      },
      defaultPaymentMethod: defaultPaymentMethod
        ? {
            lastFour: defaultPaymentMethod.lastFour,
            expiryMonth: defaultPaymentMethod.expiryMonth,
            expiryYear: defaultPaymentMethod.expiryYear,
          }
        : null,
      assignedCleaner: assignedCleaner
        ? {
            name: assignedCleaner.name,
            languages: assignedCleaner.languages,
          }
        : null,
      alerts,
      servicesCount: clientProfile?.services_count ?? 0,
    },
    { status: 200 }
  );
}

/** Extrae un campo del join `quotes` que puede venir como objeto o array. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractQuoteField(order: any, field: string): unknown {
  const q = order.quotes;
  if (!q) return null;
  if (Array.isArray(q)) return q[0]?.[field] ?? null;
  return (q as Record<string, unknown>)[field] ?? null;
}
