"use client";

import React, { useCallback,  useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, Users, Copy, CheckCircle2, Gift } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AuthModal } from "@/components/cotizador/AuthModal";
import { formatCurrency } from "@/lib/format";

interface Leader {
  id: string;
  name: string;
}

/**
 * v8.3 E5.13 — "Lulu Ambassador": página del cliente para (a) ver/generar su
 * código de referido si es VIP (>5 servicios, score >80), y (b) canjear un
 * código recibido de otro cliente (una sola vez por cuenta).
 */
export default function ReferralsPage() {
  const t = useTranslations("cuenta.referidos");
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState(false);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [creditCents, setCreditCents] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const [redeemCode, setRedeemCode] = useState("");
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [mentionedLeaderId, setMentionedLeaderId] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMessage, setRedeemMessage] = useState("");
  const [redeemError, setRedeemError] = useState("");
  // Fix (auditoría externa 2026-07-24): mismo patrón ya aplicado en
  // MisServiciosClient.tsx -- este componente no comprobaba sesión antes de
  // pedir datos, así que una sesión expirada entre el chequeo del layout
  // padre (cuenta/layout.tsx) y este fetch se mostraba como un error
  // genérico en vez de pedir login de nuevo.
  const [needsAuth, setNeedsAuth] = useState(false);

  const load = useCallback(async () => {
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

      const [refRes, leadersRes] = await Promise.all([
        fetch("/api/client/referral", { credentials: "include" }),
        fetch("/api/client/referral/leaders", { credentials: "include" }),
      ]);
      if (refRes.status === 401 || leadersRes.status === 401) {
        setNeedsAuth(true);
        return;
      }
      if (refRes.ok) {
        const data = await refRes.json();
        setEligible(Boolean(data.eligible));
        setMyCode(data.code || null);
        setCreditCents(data.creditCents || 0);
      }
      if (leadersRes.ok) {
        const data = await leadersRes.json();
        setLeaders(data.leaders || []);
      }
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);


  async function copyCode() {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard puede fallar en algunos navegadores/permiso -- no es crítico
    }
  }

  async function submitRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!redeemCode.trim()) return;
    setRedeeming(true);
    setRedeemError("");
    setRedeemMessage("");
    try {
      const res = await fetch("/api/client/referral/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: redeemCode.trim(),
          mentionedEmployeeId: mentionedLeaderId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRedeemError(data.error || t("redeemFailed"));
        return;
      }
      setRedeemMessage(data.message);
      setRedeemCode("");
    } catch {
      setRedeemError(t("networkError"));
    } finally {
      setRedeeming(false);
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
    // Fix (auditoría en vivo 2026-08-01, diseño): mismo patrón que
    // billetera/page.tsx -- alineado a max-w-3xl mx-auto px-4 py-8, igual
    // que servicios/propiedades, en vez de quedar pegado al borde izquierdo.
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("subtitle")}
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {eligible ? (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-gold-dark" />
            <p className="font-medium text-brand-ink text-sm">{t("yourCode")}</p>
          </div>
          {myCode ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-brand-ice rounded-lg px-4 py-2 text-lg font-mono font-semibold text-brand-ink">
                {myCode}
              </code>
              <button
                aria-label={t("copyCodeAriaLabel")}
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-navy text-white px-3 py-2 rounded-lg"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
          ) : (
            <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />
          )}
          {/* Fix (2026-07-25, auditoría UX, item 14): antes `creditCents || 3000`
              fabricaba "$30.00" (REFERRAL_CREDIT_CENTS, ver src/lib/referrals.ts)
              cada vez que creditCents todavía no había llegado del backend --
              en la práctica /api/client/referral siempre manda creditCents
              real cuando eligible:true (route.ts), así que el fallback era
              silenciosamente inofensivo hoy, pero seguía siendo un número
              inventado mostrado como si fuera el crédito real de la cuenta
              si esa garantía cambiara. Ahora, si por lo que sea creditCents
              aún no llegó (0), se muestra copy genérico sin monto en vez de
              inventar una cifra.

              Fix (auditoría 2026-07-31, hallazgo #9): el monto se formateaba
              a mano con un "$" fijo (`$${(creditCents / 100).toFixed(2)}`),
              ignorando el locale de la ruta -- en /fr y /zh mostraba el
              formato inglés-canadiense en vez del formateo localizado que ya
              usa el resto de "Mi Cuenta" (formatCurrency, src/lib/format.ts). */}
          <p className="text-xs text-gray-500">
            {creditCents > 0
              ? t("shareCode", { amount: formatCurrency(creditCents / 100, locale) })
              : t("shareCodeGeneric")}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-5 text-sm text-gray-500">
          <Gift className="w-6 h-6 text-gray-300 mb-2" />
          {t("notEligible")}
        </div>
      )}

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <p className="font-medium text-brand-ink text-sm">{t("haveCode")}</p>
        <form onSubmit={submitRedeem} className="space-y-2">
          <input
            aria-label={t("redeemInputAriaLabel")}
            type="text"
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value)}
            placeholder={t("redeemPlaceholder")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase"
          />
          {leaders.length > 0 && (
            <select
              aria-label={t("leaderSelectAriaLabel")}
              value={mentionedLeaderId}
              onChange={(e) => setMentionedLeaderId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">{t("leaderSelectPlaceholder")}</option>
              {leaders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          {redeemError && <p className="text-xs text-state-danger">{redeemError}</p>}
          {redeemMessage && <p className="text-xs text-state-success">{redeemMessage}</p>}
          <button
            aria-label={t("applyCodeAriaLabel")}
            type="submit"
            disabled={redeeming || !redeemCode.trim()}
            className="w-full bg-brand-navy text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {redeeming ? t("applying") : t("applyCode")}
          </button>
        </form>
      </div>
    </div>
  );
}
