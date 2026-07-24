"use client";

import React, { useState, useRef, useEffect } from "react";
import { Wallet, Search, User, CheckCircle2, X } from "lucide-react";

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  expires_at: string | null;
  created_at: string;
}

interface ClientSearchResult {
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function describeClient(c: ClientSearchResult | null): string {
  if (!c) return "";
  const namePart = c.fullName || "(no name on file)";
  const emailPart = c.email ? ` <${c.email}>` : "";
  return `${namePart}${emailPart}`;
}

export default function AdminWalletClient() {
  const [selectedClient, setSelectedClient] = useState<ClientSearchResult | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [wallet, setWallet] = useState<{ balance: number } | null>(null);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [granting, setGranting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const [grantForm, setGrantForm] = useState({ type: "credit", amountDollars: "", description: "" });
  const [showConfirm, setShowConfirm] = useState(false);

  // Fix B (auditoría 2026-07-24): reemplaza el input de UUID crudo por un
  // buscador de nombre/email/teléfono contra /api/admin/wallet/search-client.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/wallet/search-client?q=${encodeURIComponent(query.trim())}`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.clients || []);
          setShowResults(true);
        }
      } catch {
        // Búsqueda es un helper de UX -- si falla, el admin sigue pudiendo
        // ver "sin resultados" y reintentar; no bloquea el resto de la página.
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [query]);

  function selectClient(c: ClientSearchResult) {
    setSelectedClient(c);
    setQuery(describeClient(c));
    setShowResults(false);
    setWallet(null);
    setTransactions([]);
    setSuccessMessage("");
    lookup(c.userId);
  }

  function clearSelection() {
    setSelectedClient(null);
    setQuery("");
    setSearchResults([]);
    setWallet(null);
    setTransactions([]);
    setError("");
    setSuccessMessage("");
  }

  async function lookup(userId: string) {
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

  function requestGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClient || !grantForm.amountDollars) return;
    setError("");
    setSuccessMessage("");
    setShowConfirm(true);
  }

  async function confirmGrant() {
    if (!selectedClient || !grantForm.amountDollars) return;
    setGranting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          userId: selectedClient.userId,
          type: grantForm.type,
          amountDollars: Number(grantForm.amountDollars),
          description: grantForm.description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to grant");
        setShowConfirm(false);
        return;
      }
      const grantedAmount = grantForm.amountDollars;
      setSuccessMessage(
        `Granted $${Number(grantedAmount).toFixed(2)} (${grantForm.type}) to ${describeClient(selectedClient)}.`
      );
      setGrantForm({ type: "credit", amountDollars: "", description: "" });
      setShowConfirm(false);
      await lookup(selectedClient.userId);
    } catch {
      setError("Network error");
      setShowConfirm(false);
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

      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border p-4 space-y-3 relative">
        <label className="text-xs text-gray-500 block">Find client (name, email, or phone)</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              aria-label="Buscar cliente por nombre, email o teléfono"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedClient(null);
              }}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              placeholder="Start typing a name, email, or phone number..."
              className="border rounded-lg px-3 py-2 text-sm w-full"
              autoComplete="off"
            />
            {showResults && searchResults.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {searchResults.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    onClick={() => selectClient(c)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 border-b last:border-b-0"
                  >
                    <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <div>
                      <p className="text-brand-ink">{c.fullName || "(no name on file)"}</p>
                      <p className="text-xs text-gray-500">{c.email || "no email"}{c.phone ? ` · ${c.phone}` : ""}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedClient && (
            <button
              type="button"
              aria-label="Limpiar cliente seleccionado"
              onClick={clearSelection}
              className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
            >
              <X className="w-4 h-4" /> Clear
            </button>
          )}
        </div>
        {searching && <p className="text-xs text-gray-400">Searching…</p>}
        {selectedClient && (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Search className="w-3 h-3" /> Selected: {describeClient(selectedClient)}
            {loading ? " — loading wallet…" : ""}
          </p>
        )}
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

      <form onSubmit={requestGrant} className="bg-white rounded-xl border p-4 space-y-3">
        <h2 className="font-semibold text-brand-ink">Grant Credit</h2>
        {!selectedClient && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
            Search and select a client above before granting credit.
          </p>
        )}
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
          disabled={granting || !selectedClient || !grantForm.amountDollars}
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

      {/* Confirmation modal (fix B: no window.confirm) before applying credit */}
      {showConfirm && selectedClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-brand-ink">Confirm Credit Grant</h2>
            <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
              <p><strong>Client:</strong> {describeClient(selectedClient)}</p>
              <p><strong>Type:</strong> <span className="capitalize">{grantForm.type}</span></p>
              <p><strong>Amount:</strong> ${Number(grantForm.amountDollars || 0).toFixed(2)}</p>
              {grantForm.description && <p><strong>Description:</strong> {grantForm.description}</p>}
            </div>
            <p className="text-xs text-gray-500">
              This will immediately add funds to the client&apos;s wallet. Double-check the client and amount before confirming.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={granting}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                aria-label="Confirmar otorgamiento de crédito"
                onClick={confirmGrant}
                disabled={granting}
                className="flex-1 bg-brand-navy text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light disabled:opacity-50"
              >
                {granting ? "Granting..." : "Confirm & Grant"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
