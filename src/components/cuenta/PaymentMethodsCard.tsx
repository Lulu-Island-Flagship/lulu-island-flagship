"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Loader2, CreditCard, Plus, Trash2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

interface PaymentMethod {
  id: string;
  method_type: string;
  provider: string;
  last_four: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  is_default: boolean;
  created_at: string;
}

// ── Sub-componente: formulario de tarjeta nueva ─────────────────────────

function AddCardForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("cuenta.billetera.paymentMethods");
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError("");

    try {
      // 1. Obtener clientSecret del servidor
      const siRes = await fetch("/api/client/setup-intent", {
        method: "POST",
        credentials: "include",
      });
      if (!siRes.ok) throw new Error("Failed to create setup intent");
      const { clientSecret } = await siRes.json();

      // 2. Confirmar con Stripe
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card element not found");

      const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (stripeError) {
        setError(stripeError.message || t("addFailed"));
        setSaving(false);
        return;
      }

      if (!setupIntent || setupIntent.status !== "succeeded") {
        setError(t("addFailed"));
        setSaving(false);
        return;
      }

      // 3. Guardar en nuestra base de datos
      const saveRes = await fetch("/api/client/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ setupIntentId: setupIntent.id }),
      });

      if (!saveRes.ok) {
        setError(t("addFailed"));
        setSaving(false);
        return;
      }

      onSuccess();
    } catch {
      setError(t("networkError"));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="p-3 border border-brand-ice rounded-xl bg-white">
        <CardElement
          options={{
            style: {
              base: { fontSize: "16px", color: "#1a1a2e", "::placeholder": { color: "#9ca3af" } },
              invalid: { color: "#ef4444" },
            },
            hidePostalCode: true,
          }}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!stripe || saving}
          className="flex-1 px-4 py-2 bg-brand-navy text-white rounded-lg text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("saving")}
            </span>
          ) : (
            t("saveCard")
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 border border-brand-ice text-brand-ink/70 rounded-lg text-sm hover:bg-brand-ice/30 transition-colors"
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

// ── Componente principal ──────────────────────────────────────────────────

export default function PaymentMethodsCard() {
  const t = useTranslations("cuenta.billetera.paymentMethods");
  const tCommon = useTranslations("cuenta.common");

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/client/payment-methods", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      setMethods(data.methods || []);
    } catch {
      setError(tCommon("networkErrorRetry"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch("/api/client/payment-methods", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, is_default: true }),
      });
      if (!res.ok) throw new Error("Failed");
      await load();
    } catch {
      setError(t("setDefaultFailed"));
    }
  }

  async function handleRemove(id: string) {
    setRemoving(id);
    try {
      const res = await fetch(`/api/client/payment-methods?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      await load();
    } catch {
      setError(t("removeFailed"));
    } finally {
      setRemoving(null);
    }
  }

  function expiryLabel(m: PaymentMethod): string {
    if (!m.expiry_month || !m.expiry_year) return "";
    const mm = String(m.expiry_month).padStart(2, "0");
    const yy = String(m.expiry_year).slice(-2);
    return `${mm}/${yy}`;
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 text-brand-navy animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-brand-ice shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-brand-ice/50">
        <div className="flex items-center gap-2 text-brand-ink/60 text-xs font-medium uppercase tracking-wider">
          <CreditCard className="w-3.5 h-3.5" />
          {t("title")}
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-brand-navy hover:bg-brand-navy/5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("addCard")}
          </button>
        )}
      </div>

      {/* Add card form */}
      {showAddForm && (
        <div className="px-4 py-3 border-b border-brand-ice/50 bg-brand-ice/20">
          <AddCardForm
            onSuccess={() => {
              setShowAddForm(false);
              setLoading(true);
              load();
            }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-auto shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Card list */}
      {methods.length === 0 && !showAddForm ? (
        <div className="px-4 py-6 text-center text-sm text-brand-ink/50">
          <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>{t("noCards")}</p>
        </div>
      ) : (
        <div className="divide-y divide-brand-ice/30">
          {methods.map((m) => (
            <div
              key={m.id}
              className={`flex items-center justify-between px-4 py-3 ${
                m.is_default ? "bg-brand-navy/[0.02]" : ""
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <CreditCard className={`w-5 h-5 shrink-0 ${m.is_default ? "text-brand-navy" : "text-brand-ink/40"}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-ink truncate">
                    {m.provider === "stripe" ? "•••• " : ""}{m.last_four || "----"}
                    {m.is_default && (
                      <span className="ml-1.5 text-xs text-brand-navy/60 font-normal">
                        · {t("default")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-brand-ink/50">
                    {expiryLabel(m) || ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {!m.is_default && (
                  <button
                    onClick={() => handleSetDefault(m.id)}
                    className="p-1.5 text-brand-ink/40 hover:text-brand-navy transition-colors rounded-lg hover:bg-brand-ice/30"
                    title={t("setAsDefault")}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleRemove(m.id)}
                  disabled={removing === m.id}
                  className="p-1.5 text-brand-ink/30 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 disabled:opacity-50"
                  title={t("remove")}
                >
                  {removing === m.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
