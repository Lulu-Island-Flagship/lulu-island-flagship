"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Wallet, Gift } from "lucide-react";

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

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function WalletPage() {
  const [balance, setBalance] = useState(0);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [orders, setOrders] = useState<UnpaidOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [walletRes, ordersRes] = await Promise.all([
        fetch("/api/client/wallet", { credentials: "include" }),
        fetch("/api/client/orders", { credentials: "include" }),
      ]);
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
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function applyToOrder(orderId: string) {
    setApplying(orderId);
    setError("");
    try {
      const res = await fetch("/api/client/wallet/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to apply");
        return;
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setApplying(null);
    }
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
        <h1 className="text-2xl font-bold text-brand-ink">Lulu Wallet</h1>
        <p className="text-sm text-gray-500 mt-1">
          Referral, resolution, and promo credits. Credits expire 12 months after being granted.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-brand-gold/10 flex items-center justify-center">
          <Wallet className="w-6 h-6 text-brand-gold-dark" />
        </div>
        <div>
          <p className="text-2xl font-bold text-brand-ink">{formatDollars(availableBalance)}</p>
          <p className="text-xs text-gray-500">Available to spend</p>
        </div>
      </div>

      {orders.length > 0 && availableBalance > 0 && (
        <div>
          <h2 className="font-semibold text-brand-ink mb-2">Apply to an upcoming service</h2>
          <div className="bg-white rounded-xl border divide-y">
            {orders.map((o) => (
              <div key={o.id} className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-brand-ink">{o.service_date}</p>
                  <p className="text-xs text-gray-500">{o.status}</p>
                </div>
                <button
                  onClick={() => applyToOrder(o.id)}
                  disabled={applying === o.id}
                  className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {applying === o.id ? "Applying..." : "Apply credit"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">History</h2>
        {transactions.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
            <Gift className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            No wallet activity yet.
          </div>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {transactions.map((t) => (
              <div key={t.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="text-brand-ink">{t.description || t.type}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(t.created_at).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })}
                    {t.expires_at && ` — expires ${new Date(t.expires_at).toLocaleDateString("en-CA")}`}
                  </p>
                </div>
                <span className={t.type === "debit" || t.type === "payout" ? "text-state-danger" : "text-state-success"}>
                  {t.type === "debit" || t.type === "payout" ? "-" : "+"}
                  {formatDollars(t.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
