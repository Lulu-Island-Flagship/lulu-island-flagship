"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { AuthModal } from "@/components/cotizador/AuthModal";
import { ThumbsUp, ThumbsDown, Loader2, CheckCircle2, Home, Gift } from "lucide-react";

export default function PreReviewSurveyPage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;
  const t = useTranslations("survey");

  const locale = (typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [satisfied, setSatisfied] = useState<boolean | null>(null);
  const [complaintText, setComplaintText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [creditGranted, setCreditGranted] = useState(0);
  // Fix 2026-07-24 (auditoría encuesta/[token]): `orders` tiene RLS "Clients
  // read own orders" (auth.uid() = client_id, migración 001/008) -- un
  // cliente que abre el link de la encuesta (SMS/email) sin sesión activa en
  // ese navegador siempre recibe 0 filas, exactamente el mismo resultado
  // PostgREST que un token inválido/expirado. Antes eso se mostraba como
  // "This survey link is invalid or expired.", lo cual es falso y confunde:
  // el token es válido, solo falta loguearse. Ahora se verifica la sesión
  // ANTES de consultar `orders`; sin sesión se muestra un login (mismo
  // AuthModal que el resto del sitio), y solo si YA hay sesión y la consulta
  // igual falla se asume token inválido/expirado (causa real distinta, no
  // debe mezclarse con "falta login").
  const [needsAuth, setNeedsAuth] = useState(false);

  // Fix (auditoría 2026-07-31, hallazgo #18): mismo criterio que el POST
  // server-side (src/app/api/client/pre-review-survey/route.ts) -- 72h
  // desde `pre_review_survey_sent_at`. La validación real vive en el
  // servidor; esto solo evita mostrar el formulario completo para que
  // recién al enviar el cliente descubra que expiró.
  const PRE_REVIEW_SURVEY_RESPONSE_WINDOW_MS = 72 * 60 * 60 * 1000;

  useEffect(() => {
    verifyToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function verifyToken() {
    setLoading(true);
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

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, status, pre_review_survey_sent_at")
        .eq("pre_review_survey_token", token)
        .single();

      if (orderError || !order) {
        setError(t("invalidOrExpired"));
        setLoading(false);
        return;
      }

      const { data: existing } = await supabase
        .from("pre_review_surveys")
        .select("id")
        .eq("order_id", order.id)
        .maybeSingle();

      if (existing) {
        setSubmitted(true);
        setLoading(false);
        return;
      }

      if (
        !order.pre_review_survey_sent_at ||
        Date.now() - new Date(order.pre_review_survey_sent_at).getTime() > PRE_REVIEW_SURVEY_RESPONSE_WINDOW_MS
      ) {
        setError(t("invalidOrExpired"));
        setLoading(false);
        return;
      }
    } catch {
      setError(t("somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (satisfied === null) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/client/pre-review-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, satisfied, complaintText: satisfied ? undefined : complaintText }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreditGranted(data.walletCreditCents || 0);
        setSubmitted(true);
      } else {
        setError(data.error || t("submitFailed"));
      }
    } catch {
      setError(t("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </main>
    );
  }

  // Fix 2026-07-24: caso "falta login", distinto de "token inválido" --
  // ver comentario junto a needsAuth arriba. onSuccess reintenta
  // verifyToken (mismo token, misma URL) tras autenticarse.
  if (needsAuth) {
    return (
      <main className="min-h-screen bg-brand-ice">
        <AuthModal
          onClose={() => router.push(`/${safeLocale}`)}
          onSuccess={() => verifyToken()}
        />
      </main>
    );
  }

  if (error && !submitted) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center">
          <h2 className="text-lg font-bold text-brand-ink mb-2">{t("unavailableTitle")}</h2>
          <p className="text-sm text-gray-500">{error}</p>
          <button
            onClick={() => router.push(`/${safeLocale}`)}
            className="mt-4 inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            <Home className="w-4 h-4" /> {t("goHome")}
          </button>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center">
          <CheckCircle2 className="w-10 h-10 text-state-success mx-auto mb-3" />
          <h2 className="text-lg font-bold text-brand-ink mb-2">{t("thankYouTitle")}</h2>
          {creditGranted > 0 && (
            <p className="text-sm text-gray-600 flex items-center justify-center gap-1.5 mb-2">
              <Gift className="w-4 h-4 text-brand-gold-dark" />{" "}
              {t("creditGranted", { amount: `$${(creditGranted / 100).toFixed(2)}` })}
            </p>
          )}
          <p className="text-sm text-gray-500">{t("thankYouBody")}</p>
          <button
            onClick={() => router.push(`/${safeLocale}`)}
            className="mt-4 inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            <Home className="w-4 h-4" /> {t("goHome")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="bg-white rounded-xl shadow-elevation-1 p-6 space-y-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-brand-ink">{t("checkInTitle")}</h1>
            <p className="text-sm text-gray-500 mt-1">{t("checkInSubtitle")}</p>
          </div>

          <div className="flex justify-center gap-4">
            <button
              onClick={() => setSatisfied(true)}
              className={`flex-1 flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${satisfied === true ? "border-state-success bg-green-50" : "border-gray-200"}`}
            >
              <ThumbsUp className={`w-8 h-8 ${satisfied === true ? "text-state-success" : "text-gray-400"}`} />
              <span className="text-sm font-medium">{t("yes")}</span>
            </button>
            <button
              onClick={() => setSatisfied(false)}
              className={`flex-1 flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${satisfied === false ? "border-state-danger bg-red-50" : "border-gray-200"}`}
            >
              <ThumbsDown className={`w-8 h-8 ${satisfied === false ? "text-state-danger" : "text-gray-400"}`} />
              <span className="text-sm font-medium">{t("somethingOff")}</span>
            </button>
          </div>

          {satisfied === false && (
            <textarea
              value={complaintText}
              onChange={(e) => setComplaintText(e.target.value)}
              placeholder={t("complaintPlaceholder")}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              rows={3}
            />
          )}

          {error && <div className="text-sm text-state-danger text-center">{error}</div>}

          <button
            onClick={submit}
            disabled={submitting || satisfied === null}
            className="w-full bg-brand-navy text-white py-3 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : t("submit")}
          </button>

          <p className="text-xs text-gray-400 text-center">
            {t("privacyNote")}
          </p>
        </div>
      </div>
    </main>
  );
}
