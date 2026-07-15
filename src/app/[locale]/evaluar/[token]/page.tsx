"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [orderInfo, setOrderInfo] = useState<{ serviceDate: string; address: string } | null>(null);

  useEffect(() => {
    verifyToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function verifyToken() {
    setLoading(true);
    try {
      // El token es review_token — buscar orden por ese token
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, service_date, status, quote_id, review_token, quotes:quote_id (address)")
        .eq("review_token", token)
        .single();

      if (orderError || !order) {
        setError("Invalid or expired review link.");
        setLoading(false);
        return;
      }

      if (order.status !== "completed") {
        setError("This service has not been completed yet.");
        setLoading(false);
        return;
      }

      // Verificar ventana de 24h: service_date + 1 día >= hoy en Vancouver
      const vancouverToday = getVancouverDateString();
      const serviceDate = order.service_date as string;
      // Crear fecha en timezone Vancouver explícito para evitar desfases del browser
      const deadlineDate = new Date(serviceDate + "T23:59:59-07:00"); // PST (Vancouver)
      const deadlineStr = deadlineDate.toISOString().split("T")[0];

      if (vancouverToday > deadlineStr) {
        setError("Review window expired. You can only review within 24 hours of the service date.");
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
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function submitReview() {
    if (rating === 0) {
      setError("Please select a rating.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/client/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, comment }),
      });

      const data = await res.json();

      if (res.ok) {
        setSubmitted(true);
      } else {
        setError(data.error || "Failed to submit review.");
      }
    } catch (e) {
      console.error("Submit review error:", e);
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </main>
    );
  }

  if (error && !submitted) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center">
          <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-brand-ink mb-2">Review Unavailable</h2>
          <p className="text-sm text-gray-500">{error}</p>
          <button
            onClick={() => router.push(`/${safeLocale}`)}
            className="mt-4 inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            <Home className="w-4 h-4" />
            Go Home
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
          <h2 className="text-lg font-bold text-brand-ink mb-2">Thank You!</h2>
          <p className="text-sm text-gray-500">Your review has been submitted.</p>

          {showGoogleCta && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <p className="text-sm text-brand-ink font-medium mb-1">
                So glad you loved it! 🎉
              </p>
              <p className="text-xs text-gray-500 mb-3">
                Would you mind sharing that on Google? It takes 30 seconds and helps other families
                in Richmond find us.
              </p>
              <a
                href={GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-navy-light transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Leave a Google Review
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
            Go Home
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
            <h1 className="text-xl font-bold text-brand-ink">How was your service?</h1>
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
            {rating === 1 && "Very dissatisfied"}
            {rating === 2 && "Dissatisfied"}
            {rating === 3 && "Neutral"}
            {rating === 4 && "Satisfied"}
            {rating === 5 && "Very satisfied"}
          </div>

          {/* Comment */}
          <div>
            <label htmlFor="review-comment" className="block text-sm font-medium text-brand-ink mb-2">
              Comments (optional)
            </label>
            <textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
              rows={4}
              placeholder="Tell us about your experience..."
            />
          </div>

          {error && (
            <div className="text-sm text-state-danger text-center">{error}</div>
          )}

          <button
            aria-label="Enviar reseña"
            onClick={submitReview}
            disabled={isSubmitting || rating === 0}
            className="w-full bg-brand-navy text-white py-3 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                Submit Review
              </>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center">
            This review evaluates the team and service quality. For guarantee claims, please contact us directly.
          </p>
        </div>
      </div>
    </main>
  );
}
