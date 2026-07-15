"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2, CheckCircle2, Home } from "lucide-react";

export default function NpsSurveyPage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;

  const locale = (typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    verifyToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function verifyToken() {
    setLoading(true);
    try {
      const { data: survey, error: surveyError } = await supabase
        .from("nps_surveys")
        .select("id, responded_at")
        .eq("token", token)
        .single();

      if (surveyError || !survey) {
        setError("This survey link is invalid or expired.");
        setLoading(false);
        return;
      }
      if (survey.responded_at) {
        setSubmitted(true);
      }
    } catch {
      setError("Something went wrong.");
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
          <p className="text-sm text-gray-500">Your feedback helps us improve.</p>
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
            <h1 className="text-xl font-bold text-brand-ink">One quick question</h1>
            <p className="text-sm text-gray-500 mt-1">
              On a scale of 0-10, how likely are you to recommend us to a friend or colleague?
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
            <span>Not likely</span>
            <span>Very likely</span>
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything you'd like to add? (optional)"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={3}
          />

          {error && <div className="text-sm text-state-danger text-center">{error}</div>}

          <button
            onClick={submit}
            disabled={submitting || score === null}
            className="w-full bg-brand-navy text-white py-3 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Submit"}
          </button>
        </div>
      </div>
    </main>
  );
}
