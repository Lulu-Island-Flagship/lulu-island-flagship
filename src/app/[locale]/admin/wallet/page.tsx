"use client";

import React, { useState } from "react";
import { Wallet, Search } from "lucide-react";

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  expires_at: string | null;
  created_at: string;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AdminWalletPage() {
  const [userId, setUserId] = useState("");
  const [wallet, setWallet] = useState<{ balance: number } | null>(null);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [granting, setGranting] = useState(false);

  const [grantForm, setGrantForm] = useState({ type: "credit", amountDollars: "", description: "" });

  async function lookup() {
    if (!userId.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/wallet?userId=${encodeURIComponent(userId.trim())}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setWallet(data.wallet);
      setAvailableBalance(data.availableBalance || 0);
      setTransactions(data.transactions || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !grantForm.amountDollars) return;
    setGranting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          userId: userId.trim(),
          type: grantForm.type,
          amountDollars: Number(grantForm.amountDollars),
          description: grantForm.description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to grant");
        return;
      }
      setGrantForm({ type: "credit", amountDollars: "", description: "" });
      await lookup();
    } catch {
      setError("Network error");
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">Lulu Wallet — Admin</h1>
        <p className="text-sm text-gray-500 mt-1">
          Grant referral/resolution/promo credit to a client. Credit and promo expire 12 months; refunds do not.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <label className="text-xs text-gray-500 block">Client user_id (auth.users.id)</label>
        <div className="flex gap-2">
          <input
            type="text"
            aria-label="ID de usuario del cliente (uuid)"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="uuid"
            className="border rounded-lg px-3 py-2 text-sm flex-1"
          />
          <button
            aria-label="Buscar billetera del cliente"
            onClick={lookup}
            disabled={loading}
            className="inline-flex items-center gap-1.5 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <Search className="w-4 h-4" /> {loading ? "Loading..." : "Look up"}
          </button>
        </div>
      </div>

      {wallet && (
        <div className="bg-white rounded-xl border p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-brand-gold/10 flex items-center justify-center">
            <Wallet className="w-6 h-6 text-brand-gold-dark" />
          </div>
          <div>
            <p className="text-2xl font-bold text-brand-ink">{formatDollars(availableBalance)}</p>
            <p className="text-xs text-gray-500">Available (raw balance: {formatDollars(wallet.balance)})</p>
          </div>
        </div>
      )}

      <form onSubmit={grant} className="bg-white rounded-xl border p-4 space-y-3">
        <h2 className="font-semibold text-brand-ink">Grant Credit</h2>
        <div className="grid grid-cols-2 gap-3">
          <select
            aria-label="Tipo de crédito a otorgar"
            value={grantForm.type}
            onChange={(e) => setGrantForm((f) => ({ ...f, type: e.target.value }))}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="credit">Credit (referral/incentive, expires 12mo)</option>
            <option value="promo">Promo (expires 12mo)</option>
            <option value="refund">Refund (dispute resolution, no expiry)</option>
          </select>
          <input
            type="number"
            aria-label="Monto a otorgar en dólares"
            min={0.01}
            step="0.01"
            value={grantForm.amountDollars}
            onChange={(e) => setGrantForm((f) => ({ ...f, amountDollars: e.target.value }))}
            placeholder="Amount ($)"
            className="border rounded-lg px-3 py-2 text-sm"
            required
          />
        </div>
        <input
          type="text"
          aria-label="Descripción del crédito otorgado"
          value={grantForm.description}
          onChange={(e) => setGrantForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Description (e.g. 'Referral bonus — Jane Doe')"
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          aria-label="Otorgar crédito al cliente"
          disabled={granting}
          className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {granting ? "Granting..." : "Grant Credit"}
        </button>
      </form>

      {transactions.length > 0 && (
        <div>
          <h2 className="font-semibold text-brand-ink mb-2">History</h2>
          <div className="bg-white rounded-xl border divide-y">
            {transactions.map((t) => (
              <div key={t.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="text-brand-ink">{t.description || t.type}</p>
                  <p className="text-xs text-gray-400">{new Date(t.created_at).toLocaleDateString("en-CA")}</p>
                </div>
                <span className={t.type === "debit" || t.type === "payout" ? "text-state-danger" : "text-state-success"}>
                  {t.type === "debit" || t.type === "payout" ? "-" : "+"}
                  {formatDollars(t.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
