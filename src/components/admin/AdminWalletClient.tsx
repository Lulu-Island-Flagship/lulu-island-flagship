"use client";

import React, { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Wallet, Search, User, CheckCircle2, X } from "lucide-react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { formatCurrency } from "@/lib/format";
import { formatVancouverDate } from "@/lib/date-utils";

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

// Fix (auditoría frontend 2026-08-01, item 8): antes formateaba a mano con
// `$${(cents / 100).toFixed(2)}`, fijo en inglés e ignorando el locale del
// admin -- se unifica con formatCurrency (src/lib/format.ts), la misma
// fuente única de verdad que ya usa el resto del sitio para moneda
// localizada CAD.
function formatDollars(cents: number, locale: string): string {
  return formatCurrency(cents / 100, locale);
}

function describeClient(c: ClientSearchResult | null, noNameLabel: string): string {
  if (!c) return "";
  const namePart = c.fullName || noNameLabel;
  const emailPart = c.email ? ` <${c.email}>` : "";
  return `${namePart}${emailPart}`;
}

export default function AdminWalletClient() {
  const t = useTranslations("admin.wallet");
  const params = useParams();
  const rawLocale = params?.locale as string | undefined;
  const locale = rawLocale && ["en", "zh", "fr"].includes(rawLocale) ? rawLocale : "en";
  const TRANSACTION_TYPE_LABEL: Record<string, string> = {
    credit: t("transactionTypeLabels.credit"),
    debit: t("transactionTypeLabels.debit"),
    payout: t("transactionTypeLabels.payout"),
    refund: t("transactionTypeLabels.refund"),
    promo: t("transactionTypeLabels.promo"),
  };
  const [selectedClient, setSelectedClient] = useState<ClientSearchResult | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState("");
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
  // Fix (auditoría externa 2026-07-31): este modal de confirmación
  // financiera era un div "fixed inset-0" hecho a mano, sin focus trap ni
  // cierre con Escape -- mismo patrón ya usado en ConfirmActionModal.
  const confirmModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(confirmModalRef, showConfirm);

  // Fix B (auditoría 2026-07-24): reemplaza el input de UUID crudo por un
  // buscador de nombre/email/teléfono contra /api/admin/wallet/search-client.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    // Fix (auditoría frontend 2026-08-01, item 6): el debounce ya evitaba
    // disparar un fetch por cada tecla, pero si el admin seguía escribiendo
    // mientras una búsqueda anterior seguía en vuelo, esa respuesta tardía
    // podía llegar DESPUÉS de la más reciente y pisar los resultados con
    // datos obsoletos. AbortController cancela la petición anterior en
    // cuanto empieza una nueva.
    const controller = new AbortController();
    searchDebounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const res = await fetch(`/api/admin/wallet/search-client?q=${encodeURIComponent(query.trim())}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.clients || []);
          setShowResults(true);
        } else {
          // Fix (auditoría externa, hallazgo confirmado): antes un `!res.ok`
          // (la API realmente falló, ej. 500) caía silenciosamente al mismo
          // estado que "sin resultados" -- searchResults nunca se limpiaba
          // ni se avisaba del error, así que el admin veía la misma UI que
          // "no encontramos ese cliente" cuando en realidad la búsqueda
          // nunca corrió. Se distingue con un mensaje de error explícito.
          setSearchResults([]);
          setSearchError(t("searchError"));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Mismo caso que arriba pero para fallos de red/fetch -- antes el
        // catch estaba vacío y el admin no tenía forma de distinguir "sin
        // resultados" de "la búsqueda ni siquiera corrió".
        setSearchResults([]);
        setSearchError(t("searchError"));
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      controller.abort();
    };
  }, [query, t]);

  function selectClient(c: ClientSearchResult) {
    setSelectedClient(c);
    setQuery(describeClient(c, t("noNameOnFile")));
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
        setError(err.error || t("loadError"));
        return;
      }
      const data = await res.json();
      setWallet(data.wallet);
      setAvailableBalance(data.availableBalance || 0);
      setTransactions(data.transactions || []);
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!showConfirm) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !granting) setShowConfirm(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showConfirm, granting]);

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
        setError(err.error || t("grantErrorFallback"));
        setShowConfirm(false);
        return;
      }
      const grantedAmount = grantForm.amountDollars;
      setSuccessMessage(
        t("successMessage", {
          amount: formatCurrency(Number(grantedAmount), locale),
          type: TRANSACTION_TYPE_LABEL[grantForm.type] || grantForm.type,
          client: describeClient(selectedClient, t("noNameOnFile")),
        })
      );
      setGrantForm({ type: "credit", amountDollars: "", description: "" });
      setShowConfirm(false);
      await lookup(selectedClient.userId);
    } catch {
      setError(t("networkError"));
      setShowConfirm(false);
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("heading")}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("subtitle")}
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
        <label className="text-xs text-gray-500 block">{t("findClientLabel")}</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              aria-label={t("searchAriaLabel")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedClient(null);
                setSearchError("");
                // Fix (revisión 2026-07-30, punto 10): al cambiar el texto de
                // búsqueda se limpiaba selectedClient pero no wallet/transactions
                // -- el balance y el historial de la búsqueda anterior seguían
                // visibles en pantalla mientras el admin escribía un nuevo
                // nombre, con riesgo de leer/otorgar sobre el cliente
                // equivocado antes de seleccionar uno nuevo.
                setWallet(null);
                setTransactions([]);
              }}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              placeholder={t("searchPlaceholder")}
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
                      <p className="text-brand-ink">{c.fullName || t("noNameOnFile")}</p>
                      <p className="text-xs text-gray-500">{c.email || t("noEmail")}{c.phone ? ` · ${c.phone}` : ""}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedClient && (
            <button
              type="button"
              aria-label={t("clearAriaLabel")}
              onClick={clearSelection}
              className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
            >
              <X className="w-4 h-4" /> {t("clear")}
            </button>
          )}
        </div>
        {searching && <p className="text-xs text-gray-400">{t("searching")}</p>}
        {!searching && searchError && <p className="text-xs text-state-danger">{searchError}</p>}
        {selectedClient && (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Search className="w-3 h-3" /> {t("selectedPrefix")} {describeClient(selectedClient, t("noNameOnFile"))}
            {loading ? t("loadingWalletSuffix") : ""}
          </p>
        )}
      </div>

      {wallet && (
        <div className="bg-white rounded-xl border p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-brand-gold/10 flex items-center justify-center">
            <Wallet className="w-6 h-6 text-brand-gold-dark" />
          </div>
          <div>
            <p className="text-2xl font-bold text-brand-ink">{formatDollars(availableBalance, locale)}</p>
            <p className="text-xs text-gray-500">{t("availableBalanceLabel", { balance: formatDollars(wallet.balance, locale) })}</p>
          </div>
        </div>
      )}

      <form onSubmit={requestGrant} className="bg-white rounded-xl border p-4 space-y-3">
        <h2 className="font-semibold text-brand-ink">{t("grantCreditHeading")}</h2>
        {!selectedClient && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
            {t("selectClientWarning")}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <select
            aria-label={t("typeSelectAriaLabel")}
            value={grantForm.type}
            onChange={(e) => setGrantForm((f) => ({ ...f, type: e.target.value }))}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="credit">{t("typeOptions.credit")}</option>
            <option value="promo">{t("typeOptions.promo")}</option>
            <option value="refund">{t("typeOptions.refund")}</option>
          </select>
          <input
            type="number"
            aria-label={t("amountAriaLabel")}
            min={0.01}
            step="0.01"
            value={grantForm.amountDollars}
            onChange={(e) => setGrantForm((f) => ({ ...f, amountDollars: e.target.value }))}
            placeholder={t("amountPlaceholder")}
            className="border rounded-lg px-3 py-2 text-sm"
            required
          />
        </div>
        <input
          type="text"
          aria-label={t("descriptionAriaLabel")}
          value={grantForm.description}
          onChange={(e) => setGrantForm((f) => ({ ...f, description: e.target.value }))}
          placeholder={t("descriptionPlaceholder")}
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          aria-label={t("grantButtonAriaLabel")}
          disabled={granting || !selectedClient || !grantForm.amountDollars}
          className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {granting ? t("granting") : t("grantButton")}
        </button>
      </form>

      {transactions.length > 0 && (
        <div>
          <h2 className="font-semibold text-brand-ink mb-2">{t("historyHeading")}</h2>
          <div className="bg-white rounded-xl border divide-y">
            {transactions.map((tx) => (
              <div key={tx.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="text-brand-ink">{tx.description || TRANSACTION_TYPE_LABEL[tx.type] || tx.type}</p>
                  <p className="text-xs text-gray-400">{formatVancouverDate(tx.created_at, "en")}</p>
                </div>
                <span className={tx.type === "debit" || tx.type === "payout" ? "text-state-danger" : "text-state-success"}>
                  {tx.type === "debit" || tx.type === "payout" ? "-" : "+"}
                  {formatDollars(Math.abs(tx.amount), locale)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation modal (fix B: no window.confirm) before applying credit */}
      {showConfirm && selectedClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div ref={confirmModalRef} role="dialog" aria-modal="true" className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-brand-ink">{t("confirmModal.title")}</h2>
            <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
              <p><strong>{t("confirmModal.clientLabel")}</strong> {describeClient(selectedClient, t("noNameOnFile"))}</p>
              <p><strong>{t("confirmModal.typeLabel")}</strong> <span className="capitalize">{TRANSACTION_TYPE_LABEL[grantForm.type] || grantForm.type}</span></p>
              <p><strong>{t("confirmModal.amountLabel")}</strong> {formatCurrency(Number(grantForm.amountDollars || 0), locale)}</p>
              {grantForm.description && <p><strong>{t("confirmModal.descriptionLabel")}</strong> {grantForm.description}</p>}
            </div>
            <p className="text-xs text-gray-500">
              {t("confirmModal.warning")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={granting}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
              >
                {t("confirmModal.cancel")}
              </button>
              <button
                type="button"
                aria-label={t("confirmModal.confirmAriaLabel")}
                onClick={confirmGrant}
                disabled={granting}
                className="flex-1 bg-brand-navy text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light disabled:opacity-50"
              >
                {granting ? t("confirmModal.granting") : t("confirmModal.confirmButton")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
