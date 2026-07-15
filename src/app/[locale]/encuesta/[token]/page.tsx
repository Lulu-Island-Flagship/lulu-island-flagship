"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ThumbsUp, ThumbsDown, Loader2, CheckCircle2, Home, Gift } from "lucide-react";

export default function PreReviewSurveyPage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;

  const locale = (typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [satisfied, setSatisfied] = useState<boolean | null>(null);
  const [complaintText, setComplaintText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [creditGranted, setCreditGranted] = useState(0);

  useEffect(() => {
    verifyToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function verifyToken() {
    setLoading(true);
    try {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, status")
        .eq("pre_review_survey_token", token)
        .single();

      if (orderError || !order) {
        setError("This survey link is invalid or expired.");
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
      }
    } catch {
      setError("Something went wrong.");
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
        setError(data.error || "Failed to submit.");
      }
    } catch {
      setError("Network error. Please try again.");
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

  if (error && !submitted) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center">
          <h2 className="text-lg font-bold text-brand-ink mb-2">Survey Unavailable</h2>
          <p className="text-sm text-gray-500">{error}</p>
          <button
            onClick={() => router.push(`/${safeLocale}`)}
            className="mt-4 inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            <Home className="w-4 h-4" /> Go Home
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
          <h2 className="text-lg font-bold text-brand-ink mb-2">Thank you!</h2>
          {creditGranted > 0 && (
            <p className="text-sm text-gray-600 flex items-center justify-center gap-1.5 mb-2">
              <Gift className="w-4 h-4 text-brand-gold-dark" /> ${(creditGranted / 100).toFixed(2)} added to your
              Lulu Wallet
            </p>
          )}
          <p className="text-sm text-gray-500">We appreciate you taking the time.</p>
          <button
            onClick={() => router.push(`/${safeLocale}`)}
            className="mt-4 inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            <Home className="w-4 h-4" /> Go Home
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
            <h1 className="text-xl font-bold text-brand-ink">Quick 30-second check-in</h1>
            <p className="text-sm text-gray-500 mt-1">Was everything to your satisfaction?</p>
          </div>

          <div className="flex justify-center gap-4">
            <button
              onClick={() => setSatisfied(true)}
              className={`flex-1 flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${satisfied === true ? "border-state-success bg-green-50" : "border-gray-200"}`}
            >
              <ThumbsUp className={`w-8 h-8 ${satisfied === true ? "text-state-success" : "text-gray-400"}`} />
              <span className="text-sm font-medium">Yes</span>
            </button>
            <button
              onClick={() => setSatisfied(false)}
              className={`flex-1 flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${satisfied === false ? "border-state-danger bg-red-50" : "border-gray-200"}`}
            >
              <ThumbsDown className={`w-8 h-8 ${satisfied === false ? "text-state-danger" : "text-gray-400"}`} />
              <span className="text-sm font-medium">Something's off</span>
            </button>
          </div>

          {satisfied === false && (
            <textarea
              value={complaintText}
              onChange={(e) => setComplaintText(e.target.value)}
              placeholder="What happened? We'll follow up quickly."
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
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Submit"}
          </button>

          <p className="text-xs text-gray-400 text-center">
            This is a private check-in, not a public review. You'll get $10 Lulu Wallet credit for answering.
          </p>
        </div>
      </div>
    </main>
  );
}
