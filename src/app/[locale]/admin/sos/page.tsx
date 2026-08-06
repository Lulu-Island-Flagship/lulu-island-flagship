"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Siren, Loader2, CheckCircle2, ClipboardCheck } from "lucide-react";

// v8.3 E7 (D.10 #7) — Bandeja de aborto seguro (SOS).
// P0 seguridad humana. El sistema aprueba primero; la revisión ex-post es
// SIEMPRE obligatoria (B.3.5), sin importar en qué etapa se auto-aprobó.

type Stage = "sos_active" | "escalated_admin_call" | "escalated_emergency_admin" | "auto_approved" | "acknowledged";

interface SafetyAbort {
  id: string;
  order_id: string | null;
  reason: string | null;
  sos_started_at: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  acknowledged_at: string | null;
  stage: Stage;
  auto_approved: boolean;
  ex_post_reviewed_at: string | null;
  evidence_supports_leader: boolean | null;
  sanction_prohibited: boolean | null;
  review_notes: string | null;
  created_at: string;
  computed: { stage: Stage; minutesElapsed: number; autoApproved: boolean } | null;
  requiresExPostReview: boolean;
}

const STAGE_COLORS: Record<Stage, string> = {
  sos_active: "bg-yellow-100 text-yellow-800",
  escalated_admin_call: "bg-orange-100 text-orange-800",
  escalated_emergency_admin: "bg-red-100 text-red-800",
  auto_approved: "bg-red-100 text-red-800",
  acknowledged: "bg-green-100 text-green-800",
};

export default function SosPage() {
  const t = useTranslations("admin.sos");
  const [items, setItems] = useState<SafetyAbort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<Record<string, { evidenceSupportsLeader: boolean; notes: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/safety-aborts", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setItems(data.safetyAborts || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function acknowledge(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/safety-aborts/${id}/acknowledge`, { method: "POST", credentials: "include" });
      if (res.ok) await load();
    } finally {
      setBusyId(null);
    }
  }

  async function submitReview(id: string) {
    const draft = reviewDraft[id];
    if (!draft) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/safety-aborts/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ evidenceSupportsLeader: draft.evidenceSupportsLeader, notes: draft.notes }),
      });
      if (res.ok) await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-1">
          <Siren className="w-5 h-5 text-state-danger" />
          <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">{t("subtitle")}</p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
        ) : (
          <div className="space-y-3">
            {items.length === 0 && (
              <p className="bg-white rounded-xl shadow-elevation-1 p-4 text-sm text-gray-500">
                {t("emptyState")}
              </p>
            )}
            {items.map((it) => {
              const stage = it.computed?.stage || it.stage;
              const draft = reviewDraft[it.id] || { evidenceSupportsLeader: true, notes: "" };
              return (
                <div key={it.id} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[stage]}`}>
                      {t(`stages.${stage}`)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(it.created_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
                    </span>
                  </div>
                  {it.reason && <p className="text-sm text-gray-700">{it.reason}</p>}
                  {it.gps_lat !== null && it.gps_lng !== null && (
                    <p className="text-xs text-gray-500">{t("gps", { lat: it.gps_lat.toFixed(5), lng: it.gps_lng.toFixed(5) })}</p>
                  )}

                  {!it.acknowledged_at && (
                    <button
                      onClick={() => acknowledge(it.id)}
                      disabled={busyId === it.id}
                      className="flex items-center gap-1 bg-brand-navy text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> {t("acknowledgeAction")}
                    </button>
                  )}

                  <div className="border-t pt-2 mt-2">
                    {it.ex_post_reviewed_at ? (
                      <div className="text-xs text-gray-600 flex items-start gap-1.5">
                        <ClipboardCheck className="w-3.5 h-3.5 text-state-success flex-shrink-0 mt-0.5" />
                        <span>
                          {t("reviewedSummary", {
                            supports: it.evidence_supports_leader ? t("supports") : t("doesNotSupport"),
                            sanction: it.sanction_prohibited ? t("sanctionProhibited") : t("sanctionNotProhibited"),
                          })}
                          {it.review_notes && <> {it.review_notes}</>}
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-state-warning">{t("reviewPending")}</p>
                        <div className="flex items-center gap-3 text-xs">
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              aria-label={t("evidenceSupportsAria")}
                              checked={draft.evidenceSupportsLeader === true}
                              onChange={() => setReviewDraft({ ...reviewDraft, [it.id]: { ...draft, evidenceSupportsLeader: true } })}
                            />
                            {t("evidenceSupportsLabel")}
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              aria-label={t("evidenceDoesNotSupportAria")}
                              checked={draft.evidenceSupportsLeader === false}
                              onChange={() => setReviewDraft({ ...reviewDraft, [it.id]: { ...draft, evidenceSupportsLeader: false } })}
                            />
                            {t("evidenceDoesNotSupportLabel")}
                          </label>
                        </div>
                        <input
                          type="text"
                          aria-label={t("reviewNotesAria")}
                          placeholder={t("reviewNotesPlaceholder")}
                          value={draft.notes}
                          onChange={(e) => setReviewDraft({ ...reviewDraft, [it.id]: { ...draft, notes: e.target.value } })}
                          className="w-full text-xs border rounded-lg px-2 py-1.5"
                        />
                        <button
                          onClick={() => submitReview(it.id)}
                          disabled={busyId === it.id}
                          className="bg-brand-navy text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                        >
                          {t("recordReview")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
