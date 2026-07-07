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
} from "lucide-react";

// Helper: obtener fecha actual en zona horaria America/Vancouver como string YYYY-MM-DD
function getVancouverDateString(): string {
  return new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).split(",")[0];
}

export default function EvaluarPage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [orderInfo, setOrderInfo] = useState<{ serviceDate: string; address: string } | null>(null);

  useEffect(() => {
    verifyToken();
  }, [token]);

  async function verifyToken() {
    setLoading(true);
    try {
      // El token es el orderId — verificar que la orden existe y está completada
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, service_date, status, quote_id, quotes:quote_id (address)")
        .eq("id", token)
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
      const deadlineDate = new Date(serviceDate + "T00:00:00");
      deadlineDate.setDate(deadlineDate.getDate() + 1);
      const deadlineStr = deadlineDate.toISOString().split("T")[0];

      if (vancouverToday > deadlineStr) {
        setError("Review window expired. You can only review within 24 hours of the service date.");
        setLoading(false);
        return;
      }

      // Verificar que no haya review ya
      const { data: existing } = await supabase
        .from("client_reviews")
        .select("id")
        .eq("order_id", token)
        .single();

      if (existing) {
        setSubmitted(true);
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
        credentials: "include",
        body: JSON.stringify({ orderId: token, rating, comment }),
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
            onClick={() => router.push("/")}
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
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center">
          <CheckCircle2 className="w-10 h-10 text-state-success mx-auto mb-3" />
          <h2 className="text-lg font-bold text-brand-ink mb-2">Thank You!</h2>
          <p className="text-sm text-gray-500">Your review has been submitted.</p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
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
            <label className="block text-sm font-medium text-brand-ink mb-2">
              Comments (optional)
            </label>
            <textarea
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
