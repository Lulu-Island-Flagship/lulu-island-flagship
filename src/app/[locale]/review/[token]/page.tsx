"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { getVancouverOffset } from "@/lib/date-utils";
import {
  Star,
  Loader2,
  Send,
  CheckCircle2,
  Home,
  MessageSquare,
  ExternalLink,
} from "lucide-react";

/**
 * v8.3 — AUDITORÍA DE FLUJO RESERVA→DINERO→RESEÑA: hallazgo real. En TODO
 * el repo no existía ningún código que construyera un link real de reseña
 * de Google Business Profile ni que lo mostrara al cliente -- "/evaluar"
 * (esta página), la encuesta NPS y la encuesta pre-reseña son las tres
 * superficies de "reseña" que existen, y las tres son internas: terminan en
 * una tabla propia (client_reviews / nps_surveys / pre_review_surveys),
 * nunca en Google. El plan pide explícitamente que el flujo llegue "hasta
 * que ponen una reseña en Google" -- ese último paso de conversión no
 * existía en absoluto, no era un bug de código sino una pieza faltante.
 *
 * Fix: cuando el cliente califica 4-5★ aquí, se le ofrece un botón para
 * dejar la reseña pública en Google (mismo criterio que ya usa
 * pre-review-survey.ts para el link de referido: solo se enruta a canales
 * públicos/de crecimiento a clientes ya confirmados como satisfechos;
 * insatisfechos se quedan en el canal privado -- eso ya era el patrón
 * establecido en este código, no una regla nueva). El link real
 * (NEXT_PUBLIC_GOOGLE_REVIEW_URL) es un dato del mundo real que debe
 * configurar el dueño (su URL corta real de Google Business Profile,
 * "g.page/r/.../review") -- si no está configurado, el botón simplemente no
 * se muestra en vez de romperse con un link falso.
 */
const GOOGLE_REVIEW_URL = process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL || "";

// Helper: obtener fecha actual en zona horaria America/Vancouver como string YYYY-MM-DD
function getVancouverDateString(): string {
  return new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).split(",")[0];
}

export default function EvaluarPage() {
  const t = useTranslations("evaluar");
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;

  // Detect locale from pathname for navigation
  const locale = (typeof window !== "undefined"
    ? window.location.pathname.split("/")[1]
    : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  // Fix (auditoría UX/seguridad 2026-07-30, BUG 4): segundo factor ligero
  // además del review_token -- ver src/app/api/client/review/route.ts.
  const [phoneLast4, setPhoneLast4] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [orderInfo, setOrderInfo] = useState<{ serviceDate: string; address: string } | null>(null);

  const verifyToken = useCallback(async () => {
    setLoading(true);
    try {
      // El token es review_token — buscar orden por ese token
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, service_date, status, quote_id, review_token, quotes:quote_id (address)")
        .eq("review_token", token)
        .single();

      if (orderError || !order) {
        setError(t("errors.invalidLink"));
        setLoading(false);
        return;
      }

      if (order.status !== "completed") {
        setError(t("errors.notCompleted"));
        setLoading(false);
        return;
      }

      // Verificar ventana de 24h: service_date + 1 día >= hoy en Vancouver
      //
      // Fix (auditoría 2026-07-31, hallazgo #19): el offset usado aquí
      // estaba hardcodeado a "-07:00" (PDT, horario de verano) todo el
      // año -- BC usa "-08:00" (PST) de noviembre a marzo. Con el offset
      // fijo, en temporada PST este chequeo calculaba un deadline hasta
      // un día ANTES del real, mostrando "ventana expirada" hasta 24h
      // antes de que realmente expirara -- un falso rechazo que le
      // ocultaba el formulario a un cliente con un link todavía válido.
      // Se usa getVancouverOffset() (src/lib/date-utils.ts), que calcula
      // el offset real PDT/PST para la fecha dada vía Intl, mismo helper
      // que ya usa el resto del repo (ej. parseVancouverDateTime).
      //
      // IMPORTANTE: este chequeo es solo una pre-filtración de UX (evita
      // mostrar el formulario completo si el link obviamente ya venció) --
      // la validación real y definitiva de la ventana de 24h ocurre
      // SIEMPRE en el servidor (POST /api/client/review, que recalcula el
      // deadline exacto con service_date+service_time+offset real contra
      // Date.now()) y nunca confía solo en este cálculo del navegador.
      const vancouverToday = getVancouverDateString();
      const serviceDate = order.service_date as string;
      const offset = getVancouverOffset(serviceDate);
      const deadlineDate = new Date(`${serviceDate}T23:59:59${offset}`);
      const deadlineStr = deadlineDate.toISOString().split("T")[0];

      if (vancouverToday > deadlineStr) {
        setError(t("errors.windowExpired"));
        setLoading(false);
        return;
      }

      // Verificar que no haya review ya (por review_token_used_at o por client_reviews)
      const { data: existing } = await supabase
        .from("client_reviews")
        .select("id")
        .eq("order_id", order.id)
        .single();

      if (existing) {
        setSubmitted(true);
        setLoading(false);
        return;
      }

      // Verificar que el token no haya sido usado ya
      const { data: orderWithToken } = await supabase
        .from("orders")
        .select("review_token_used_at")
        .eq("id", order.id)
        .single();

      if (orderWithToken?.review_token_used_at) {
        setSubmitted(true);
        setLoading(false);
        return;
      }

      setOrderInfo({
        serviceDate: order.service_date,
        address: (order.quotes as unknown as { address: string })?.address || "",
      });
    } catch (e) {
      console.error("Verify token error:", e);
      setError(t("errors.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    verifyToken();
  }, [token, verifyToken]);

  async function submitReview() {
    if (rating === 0) {
      setError(t("errors.selectRating"));
      return;
    }

    // Fix (auditoría UX/seguridad 2026-07-30, BUG 4): validar en el cliente
    // antes de enviar -- el servidor exige este dato cuando el perfil tiene
    // un teléfono registrado (ver route.ts), así que se pide siempre aquí
    // para no obligar a un segundo viaje de ida y vuelta en el caso común.
    if (phoneLast4.replace(/\D/g, "").length !== 4) {
      setError(t("errors.phoneLast4Required"));
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/client/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, comment, phoneLast4 }),
      });

      const data = await res.json();

      if (res.ok) {
        setSubmitted(true);
      } else if (res.status === 403) {
        setError(t("errors.phoneMismatch"));
      } else {
        setError(data.error || t("errors.submitFailed"));
      }
    } catch (e) {
      console.error("Submit review error:", e);
      setError(t("errors.networkError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
      </main>
    );
  }

  if (error && !submitted) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center">
          <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-brand-ink mb-2">{t("unavailable.title")}</h2>
          <p className="text-sm text-gray-500">{error}</p>
          <button
            onClick={() => router.push(`/${safeLocale}`)}
            className="mt-4 inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            <Home className="w-4 h-4" />
            {t("unavailable.goHome")}
          </button>
        </div>
      </main>
    );
  }

  if (submitted) {
    const showGoogleCta = rating >= 4 && GOOGLE_REVIEW_URL;
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center">
          <CheckCircle2 className="w-10 h-10 text-state-success mx-auto mb-3" />
          <h2 className="text-lg font-bold text-brand-ink mb-2">{t("thankYou.title")}</h2>
          <p className="text-sm text-gray-500">{t("thankYou.body")}</p>

          {showGoogleCta && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <p className="text-sm text-brand-ink font-medium mb-1">
                {t("thankYou.googleTitle")}
              </p>
              <p className="text-xs text-gray-500 mb-3">
                {t("thankYou.googleBody")}
              </p>
              <a
                href={GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-navy-light transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                {t("thankYou.googleCta")}
              </a>
            </div>
          )}

          <button
            onClick={() => router.push(`/${safeLocale}`)}
            className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${
              showGoogleCta
                ? "text-brand-navy border border-brand-navy hover:bg-brand-ice"
                : "bg-brand-navy text-white"
            }`}
          >
            <Home className="w-4 h-4" />
            {t("thankYou.goHome")}
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
            <h1 className="text-xl font-bold text-brand-ink">{t("form.title")}</h1>
            {orderInfo && (
              <p className="text-sm text-gray-500 mt-1">
                {orderInfo.address}
                <br />
                {new Date(orderInfo.serviceDate).toLocaleDateString("en-CA", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            )}
          </div>

          {/* Rating Stars */}
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                onClick={() => { setRating(s); setError(""); }}
                className="transition-transform hover:scale-110"
              >
                <Star
                  className={`w-10 h-10 ${
                    rating >= s
                      ? "text-yellow-400 fill-current"
                      : "text-gray-300"
                  }`}
                />
              </button>
            ))}
          </div>

          <div className="text-center text-sm text-gray-500">
            {rating === 1 && t("form.ratingLabels.1")}
            {rating === 2 && t("form.ratingLabels.2")}
            {rating === 3 && t("form.ratingLabels.3")}
            {rating === 4 && t("form.ratingLabels.4")}
            {rating === 5 && t("form.ratingLabels.5")}
          </div>

          {/* Comment */}
          <div>
            <label htmlFor="review-comment" className="block text-sm font-medium text-brand-ink mb-2">
              {t("form.commentLabel")}
            </label>
            <textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
              rows={4}
              placeholder={t("form.commentPlaceholder")}
            />
          </div>

          {/* Fix (auditoría UX/seguridad 2026-07-30, BUG 4): segundo factor
              ligero -- confirma que quien completa el formulario tiene
              acceso al teléfono del cliente, no solo al link. */}
          <div>
            <label htmlFor="review-phone-last4" className="block text-sm font-medium text-brand-ink mb-2">
              {t("form.phoneLast4Label")}
            </label>
            <input
              id="review-phone-last4"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={phoneLast4}
              onChange={(e) => { setPhoneLast4(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
              placeholder={t("form.phoneLast4Placeholder")}
              className="w-full border rounded-lg px-3 py-2 text-sm text-center tracking-widest focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
            />
          </div>

          {error && (
            <div className="text-sm text-state-danger text-center">{error}</div>
          )}

          <button
            aria-label={t("form.submitAriaLabel")}
            onClick={submitReview}
            disabled={isSubmitting || rating === 0 || phoneLast4.length !== 4}
            className="w-full bg-brand-navy text-white py-3 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                {t("form.submit")}
              </>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center">
            {t("form.disclaimer")}
          </p>
        </div>
      </div>
    </main>
  );
}
