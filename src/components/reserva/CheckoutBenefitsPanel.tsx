"use client";

import React, { useEffect, useState } from "react";
import { Gift, Wallet, Loader2 } from "lucide-react";

interface BenefitsResponse {
  wallet: { availableBalance: number; currency: string };
  referral: { hasPendingCredit: boolean; creditCents: number };
}

function formatCurrency(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

/**
 * v8.3 — Panel informativo de "qué más te llevas" en el checkout
 * (/reserva/[quoteId]). Solo lectura: NO aplica nada al total de esta
 * reserva (ver honestidad de alcance en /api/client/checkout-benefits) --
 * muestra saldo de Lulu Wallet y crédito de referido pendiente, con un
 * enlace a donde sí se puede aplicar/gestionar.
 */
export function CheckoutBenefitsPanel() {
  const [data, setData] = useState<BenefitsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/client/checkout-benefits", { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // silencioso -- este panel es informativo, no debe bloquear el checkout
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking your benefits…
      </div>
    );
  }

  if (!data) return null;

  const hasWalletBalance = data.wallet.availableBalance > 0;
  const hasPendingReferral = data.referral.hasPendingCredit;

  if (!hasWalletBalance && !hasPendingReferral) return null;

  return (
    <div className="bg-white rounded-lg shadow-elevation-1 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-brand-ink flex items-center gap-2">
        <Gift className="w-4 h-4 text-brand-gold" />
        Your benefits
      </h3>

      {hasWalletBalance && (
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-gray-600">
            <Wallet className="w-3.5 h-3.5" /> Lulu Wallet balance
          </span>
          <span className="font-medium text-brand-navy">
            {formatCurrency(data.wallet.availableBalance, data.wallet.currency)}
          </span>
        </div>
      )}
      {hasWalletBalance && (
        <p className="text-xs text-gray-400">
          Not applied to this booking automatically — manage it from{" "}
          <a href="/cuenta/billetera" className="underline">
            My Wallet
          </a>
          .
        </p>
      )}

      {hasPendingReferral && (
        <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-100">
          <span className="text-gray-600">Referral credit</span>
          <span className="font-medium text-state-success">
            +{formatCurrency(data.referral.creditCents, "CAD")} after this service completes
          </span>
        </div>
      )}
    </div>
  );
}
