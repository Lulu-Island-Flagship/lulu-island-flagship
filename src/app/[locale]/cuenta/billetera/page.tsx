"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Wallet, Gift } from "lucide-react";
import { StatusBanner } from "@/components/cuenta/StatusBanner";
import { supabase } from "@/lib/supabase";
import { AuthModal } from "@/components/cotizador/AuthModal";
import { toIntlLocale } from "@/lib/format";

interface WalletTransaction {
  id: string;
  type: "credit" | "debit" | "refund" | "promo" | "payout";
  amount: number;
  balance_after: number;
  description: string | null;
  expires_at: string | null;
  created_at: string;
}

interface UnpaidOrder {
  id: string;
  service_date: string;
  status: string;
  // RAÍZ-3 (2026-07-21, migración 229): orders.wallet_amount_used_cents -- centavos, no dólares.
  wallet_amount_used_cents: number;
  canApplyWalletCredit: boolean;
}

// Fix (2026-07-25, auditoría UX, item 13): antes esto era un `$` fijo
// concatenado a mano, sin importar el idioma activo -- en /zh/cuenta/billetera
// un cliente veía "$25.00" en vez del formato de moneda con el que
// realmente está familiarizado (¥25.00 o 25.00 CAD según configuración
// regional china) y en /fr/... el separador decimal/símbolo tampoco seguía
// convenciones francesas ("25,00 $"). El resto del repo no usa useLocale()
// de next-intl en ningún componente cliente (todos derivan el locale de
// window.location.pathname, mismo patrón que WalletPayButton.tsx,
// CheckoutBenefitsPanel.tsx, etc.) -- se sigue esa convención aquí también
// para no introducir un patrón nuevo. La MONEDA sigue siendo CAD siempre
// (single-currency business, ver B.2.11) -- solo cambia el locale de
// formato usado por Intl.NumberFormat.
const CURRENCY_LOCALE: Record<string, string> = { en: "en-CA", fr: "fr-CA", zh: "zh-CN" };

function formatDollars(cents: number, locale: string): string {
  const intlLocale = CURRENCY_LOCALE[locale] || "en-CA";
  return new Intl.NumberFormat(intlLocale, { style: "currency", currency: "CAD" }).format(cents / 100);
}

// orders.status CHECK constraint (migración 001_modulo1_base_schema.sql):
// ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')
const ORDER_STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];

// transactions.type — valores conocidos del backend, con fallback al tipo crudo
// si apareciera un valor nuevo no traducido.
const WALLET_TX_TYPES = ["credit", "debit", "refund", "promo", "payout"];

export default function WalletPage() {
  const t = useTranslations("cuenta.billetera");
  const tStatus = useTranslations("cuenta.orderStatus");
  const tCommon = useTranslations("cuenta.common");
  // El total histórico se recibe y guarda pero hoy solo se muestra
  // availableBalance (saldo disponible real) en la UI.
  const [_balance, setBalance] = useState(0);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [orders, setOrders] = useState<UnpaidOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
  // Fix (auditoría externa 2026-07-24): mismo patrón ya aplicado en
  // MisServiciosClient.tsx -- este componente no comprobaba sesión antes de
  // pedir datos, así que una sesión expirada entre el chequeo del layout
  // padre (cuenta/layout.tsx) y este fetch se mostraba como un StatusBanner
  // de error genérico en vez de pedir login de nuevo.
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setNeedsAuth(true);
        setLoading(false);
        return;
      }
      setNeedsAuth(false);

      const [walletRes, ordersRes] = await Promise.all([
        fetch("/api/client/wallet", { credentials: "include" }),
        fetch("/api/client/orders", { credentials: "include" }),
      ]);
      if (walletRes.status === 401 || ordersRes.status === 401) {
        setNeedsAuth(true);
        return;
      }
      if (walletRes.ok) {
        const data = await walletRes.json();
        setBalance(data.balance || 0);
        setAvailableBalance(data.availableBalance || 0);
        setTransactions(data.transactions || []);
      }
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        const unpaid = (data.orders || []).filter((o: UnpaidOrder) => o.canApplyWalletCredit);
        setOrders(unpaid);
      }
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function applyToOrder(orderId: string) {
    setApplying(orderId);
    setError("");
    setSuccessMessage("");
    try {
      const res = await fetch("/api/client/wallet/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("applyFailed"));
        return;
      }
      await load();
      setSuccessMessage(t("appliedSuccess"));
    } catch {
      setError(t("networkError"));
    } finally {
      setApplying(null);
    }
  }

  if (needsAuth) {
    return (
      <AuthModal
        onClose={() => {
          const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en";
          const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
          window.location.href = `/${safeLocale}`;
        }}
        onSuccess={() => load()}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("subtitle")}
        </p>
      </div>

      <StatusBanner
        variant="error"
        message={error}
        onRetry={load}
        onDismiss={() => setError("")}
        retryLabel={tCommon("retry")}
        dismissLabel={tCommon("dismiss")}
      />
      <StatusBanner
        variant="success"
        message={successMessage}
        onDismiss={() => setSuccessMessage("")}
        autoDismissMs={4000}
        dismissLabel={tCommon("dismiss")}
      />

      <div className="bg-white rounded-xl border p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-brand-gold/10 flex items-center justify-center">
          <Wallet className="w-6 h-6 text-brand-gold-dark" />
        </div>
        <div>
          <p className="text-2xl font-bold text-brand-ink">{formatDollars(availableBalance, safeLocale)}</p>
          <p className="text-xs text-gray-500">{t("availableToSpend")}</p>
        </div>
      </div>

      {orders.length > 0 && availableBalance > 0 && (
        <div>
          <h2 className="font-semibold text-brand-ink mb-2">{t("applyToUpcoming")}</h2>
          <div className="bg-white rounded-xl border divide-y">
            {orders.map((o) => (
              <div key={o.id} className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-brand-ink">{o.service_date}</p>
                  <p className="text-xs text-gray-500">
                    {ORDER_STATUSES.includes(o.status) ? tStatus(o.status) : o.status}
                  </p>
                </div>
                <button
                  onClick={() => applyToOrder(o.id)}
                  disabled={applying === o.id}
                  className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {applying === o.id ? t("applying") : t("applyCredit")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">{t("history")}</h2>
        {transactions.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
            <Gift className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            {t("noActivity")}
          </div>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {transactions.map((tx) => (
              <div key={tx.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="text-brand-ink">
                    {tx.description || (WALLET_TX_TYPES.includes(tx.type) ? t(`transactionType.${tx.type}`) : tx.type)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(tx.created_at).toLocaleDateString(toIntlLocale(safeLocale), { timeZone: "America/Vancouver" })}
                    {tx.expires_at && ` — ${t("expires", { date: new Date(tx.expires_at).toLocaleDateString(toIntlLocale(safeLocale)) })}`}
                  </p>
                </div>
                <span className={tx.type === "debit" || tx.type === "payout" ? "text-state-danger" : "text-state-success"}>
                  {tx.type === "debit" || tx.type === "payout" ? "-" : "+"}
                  {formatDollars(Math.abs(tx.amount), safeLocale)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
