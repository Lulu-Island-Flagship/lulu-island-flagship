"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { AuthModal } from "@/components/cotizador/AuthModal";
import { Loader2, CheckCircle2, Home } from "lucide-react";

export default function NpsSurveyPage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;
  const t = useTranslations("nps");

  const locale = (typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Fix 2026-07-24 (auditoría nps/[token], mismo problema que
  // encuesta/[token]): nps_surveys tiene RLS "Clients read own nps surveys"
  // (auth.uid() = client_user_id, migración 163). Sin sesión, la consulta
  // siempre devuelve 0 filas -- idéntico al caso de token inválido -- así que
  // antes se mostraba "This survey link is invalid or expired." a un cliente
  // con un link perfectamente válido que solo no había iniciado sesión. Se
  // verifica la sesión antes de consultar; sin sesión se pide login (no se
  // asume token inválido, esa es una causa real distinta).
  const [needsAuth, setNeedsAuth] = useState(false);

  // Fix (auditoría 2026-07-31, hallazgo #17): mismo criterio que el POST
  // server-side (src/app/api/client/nps-survey/route.ts) -- 30 días desde
  // `sent_at`. La validación real y definitiva vive en el servidor (POST
  // ya la rechaza con 410 si expiró); esto solo evita mostrarle al cliente
  // un formulario completo para que recién al enviar descubra que expiró.
  const NPS_SURVEY_RESPONSE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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

      const { data: survey, error: surveyError } = await supabase
        .from("nps_surveys")
        .select("id, responded_at, sent_at")
        .eq("token", token)
        .single();

      if (surveyError || !survey) {
        setError(t("invalidOrExpired"));
        setLoading(false);
        return;
      }
      if (survey.responded_at) {
        setSubmitted(true);
        setLoading(false);
        return;
      }
      if (Date.now() - new Date(survey.sent_at).getTime() > NPS_SURVEY_RESPONSE_WINDOW_MS) {
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
    if (score === null) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/client/nps-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, score, comment: comment.trim() || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
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
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
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
            <h1 className="text-xl font-bold text-brand-ink">{t("questionTitle")}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {t("questionSubtitle")}
            </p>
          </div>

          <div className="grid grid-cols-11 gap-1">
            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
              <button
                key={n}
                onClick={() => setScore(n)}
                className={`aspect-square rounded-lg text-sm font-medium border-2 transition-colors ${
                  score === n ? "border-brand-navy bg-brand-navy text-white" : "border-gray-200 text-gray-600"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-400 px-1">
            <span>{t("notLikely")}</span>
            <span>{t("veryLikely")}</span>
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("commentPlaceholder")}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={3}
          />

          {error && <div className="text-sm text-state-danger text-center">{error}</div>}

          <button
            onClick={submit}
            disabled={submitting || score === null}
            className="w-full bg-brand-navy text-white py-3 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : t("submit")}
          </button>
        </div>
      </div>
    </main>
  );
}
