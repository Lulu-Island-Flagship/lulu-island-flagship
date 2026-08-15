"use client";

import React, { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Loader2, AlertCircle, CheckCircle2, ImageOff, XCircle } from "lucide-react";

interface PhotoEvidence {
  id: string;
  photo_url: string;
  photo_type: string;
  zone: string | null;
  item_label: string | null;
}

interface WarrantyClaim {
  id: string;
  order_id: string;
  reason: string;
  description: string | null;
  claim_zone: string | null;
  status: string;
  severity: string;
  decision_outcome: string | null;
  requires_human_review: boolean;
  final_action: string | null;
  opened_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  auto_resolved: boolean;
  orders: { service_date: string; service_time: string } | null;
  warranty_photo_evidence: PhotoEvidence[];
}

interface ZoneClosureEvidence {
  zone: string;
  zoneLabel?: string;
  hasClosurePhoto: boolean;
  closurePhotoUrls: string[];
}

interface DisputeDecision {
  outcome: string;
  autoResolved: boolean;
  requiresHumanReview: boolean;
  suggestedAction: "free_recleaning" | "explain_no_action" | "human_review";
  hasClosureEvidenceForZone: boolean;
  hasClientEvidence: boolean;
  note: string;
}

interface ClaimDetail {
  claim: { id: string; order_id: string; claim_zone: string | null; reason: string; status: string };
  zones: ZoneClosureEvidence[];
  clientEvidence: PhotoEvidence[];
  decision: DisputeDecision;
}

const OUTCOME_KEYS: Record<string, string> = {
  auto_favor_client_missing_closure_evidence: "autoFavorClientMissingClosureEvidence",
  auto_favor_team_unsubstantiated_claim: "autoFavorTeamUnsubstantiatedClaim",
  requires_human_review_contradictory_evidence: "requiresHumanReviewContradictoryEvidence",
};

export default function WarrantyClaimsPage() {
  const t = useTranslations("admin.warrantyClaims");
  const tCommon = useTranslations("common");
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");

  const [selectedClaim, setSelectedClaim] = useState<WarrantyClaim | null>(null);
  const [detail, setDetail] = useState<ClaimDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [finalAction, setFinalAction] = useState<"free_recleaning" | "explain_no_action" | "dismiss">(
    "free_recleaning"
  );
  const [submitting, setSubmitting] = useState(false);
  const [forceCaptureReason, setForceCaptureReason] = useState("");
  const [forceCaptureSubmitting, setForceCaptureSubmitting] = useState(false);
  const [forceCaptureResult, setForceCaptureResult] = useState("");
  const [forceCaptureError, setForceCaptureError] = useState("");

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/warranty-claims?status=${statusFilter}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setClaims(data.claims || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  async function openClaim(claim: WarrantyClaim) {
    setSelectedClaim(claim);
    setDetail(null);
    setDetailError("");
    setResolutionNotes("");
    setFinalAction("free_recleaning");
    setForceCaptureReason("");
    setForceCaptureResult("");
    setForceCaptureError("");
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/warranty-claims/${claim.id}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setDetailError(err.error || t("errors.loadDetailFailed"));
        return;
      }
      const data: ClaimDetail = await res.json();
      setDetail(data);
      if (data.decision.suggestedAction !== "human_review") {
        setFinalAction(data.decision.suggestedAction);
      }
    } catch {
      setDetailError(t("errors.network"));
    } finally {
      setDetailLoading(false);
    }
  }

  async function resolveClaim() {
    if (!selectedClaim || !detail) return;
    setSubmitting(true);
    setDetailError("");
    try {
      const body: { finalAction?: string; resolutionNotes?: string } = {
        resolutionNotes: resolutionNotes.trim() || undefined,
      };
      if (detail.decision.requiresHumanReview) {
        body.finalAction = finalAction;
      }
      const res = await fetch(`/api/admin/warranty-claims/${selectedClaim.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        setDetailError(err.error || t("errors.resolveFailed"));
        setSubmitting(false);
        return;
      }
      setSelectedClaim(null);
      setDetail(null);
      loadClaims();
    } catch {
      setDetailError(t("errors.network"));
    } finally {
      setSubmitting(false);
    }
  }

  async function forceFullCapture() {
    if (!selectedClaim) return;
    if (!forceCaptureReason.trim()) {
      setForceCaptureError(t("errors.reasonRequired"));
      return;
    }
    setForceCaptureSubmitting(true);
    setForceCaptureError("");
    setForceCaptureResult("");
    try {
      const res = await fetch(`/api/admin/orders/${selectedClaim.order_id}/force-full-capture`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: forceCaptureReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setForceCaptureError(data.error || t("errors.forceCaptureFailed"));
        return;
      }
      setForceCaptureResult(
        t("forceCapture.result", { amount: data.capturedNowDollars, paymentIntentId: data.paymentIntentId ?? t("forceCapture.notApplicable") })
      );
    } catch {
      setForceCaptureError(t("errors.network"));
    } finally {
      setForceCaptureSubmitting(false);
    }
  }

  const claimZone = selectedClaim?.claim_zone;
  const matchedZone = detail?.zones.find((z) => z.zone === claimZone);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <div className="flex gap-2">
          {["open", "escalated", "resolved_client", "resolved_lulu", "dismissed"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s
                  ? "bg-brand-navy text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t(`statusFilters.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      ) : claims.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("emptyState", { status: t(`statusFilters.${statusFilter}`) })}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {claims.map((claim) => (
            <div
              key={claim.id}
              className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow flex items-start justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      claim.severity === "critical" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {claim.severity}
                  </span>
                  {claim.claim_zone && (
                    <span className="text-xs text-gray-400">{t("zoneLabel", { zone: claim.claim_zone })}</span>
                  )}
                  {claim.orders && (
                    <span className="text-xs text-gray-400">
                      {claim.orders.service_date} {claim.orders.service_time}
                    </span>
                  )}
                </div>
                <p className="text-sm text-brand-ink font-medium">{claim.reason}</p>
                {claim.description && <p className="text-sm text-gray-600">{claim.description}</p>}
                <p className="text-xs text-gray-400">
                  {t("clientPhotoCount", { count: claim.warranty_photo_evidence?.filter((e) => e.photo_type === "client").length || 0 })}
                </p>
              </div>
              {claim.status === "open" || claim.status === "escalated" ? (
                <button
                  onClick={() => openClaim(claim)}
                  className="bg-brand-navy text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors ml-2 shrink-0"
                >
                  {t("review")}
                </button>
              ) : (
                <CheckCircle2 className="w-5 h-5 text-green-400 ml-2 shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}

      {selectedClaim && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-brand-ink">{t("resolveModal.title")}</h2>
              <button onClick={() => setSelectedClaim(null)} aria-label={tCommon("close")} className="text-gray-400 hover:text-gray-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm space-y-1">
              <p>
                <strong>{t("resolveModal.claimedZone")}</strong> {selectedClaim.claim_zone || t("resolveModal.noZoneAssigned")}
              </p>
              <p>
                <strong>{t("resolveModal.reason")}</strong> {selectedClaim.reason}
              </p>
              {selectedClaim.description && <p className="text-gray-600">{selectedClaim.description}</p>}
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-brand-gold-dark" />
              </div>
            ) : detail ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-brand-ink mb-2">{t("resolveModal.closurePhotoHeading", { zone: claimZone ?? "" })}</h3>
                    {matchedZone?.hasClosurePhoto ? (
                      <div className="grid grid-cols-2 gap-2">
                        {matchedZone.closurePhotoUrls.map((url) => (
                          <div key={url} className="relative w-full aspect-square rounded-lg border overflow-hidden">
                            <Image src={url} alt={t("resolveModal.closurePhotoAlt")} fill unoptimized sizes="200px" className="object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="border border-dashed rounded-lg p-6 text-center text-gray-400">
                        <ImageOff className="w-6 h-6 mx-auto mb-1" />
                        <p className="text-xs">{t("resolveModal.noClosurePhoto")}</p>
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-brand-ink mb-2">{t("resolveModal.clientEvidenceHeading")}</h3>
                    {detail.clientEvidence.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {detail.clientEvidence.map((e) => (
                          <div key={e.id} className="relative w-full aspect-square rounded-lg border overflow-hidden">
                            <Image src={e.photo_url} alt={t("resolveModal.clientEvidenceAlt")} fill unoptimized sizes="200px" className="object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="border border-dashed rounded-lg p-6 text-center text-gray-400">
                        <ImageOff className="w-6 h-6 mx-auto mb-1" />
                        <p className="text-xs">{t("resolveModal.noClientEvidence")}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className={`rounded-lg p-3 text-sm ${
                    detail.decision.requiresHumanReview
                      ? "bg-yellow-50 border border-yellow-200 text-yellow-800"
                      : "bg-blue-50 border border-blue-200 text-blue-800"
                  }`}
                >
                  <p className="font-medium">
                    {OUTCOME_KEYS[detail.decision.outcome] ? t(`outcomes.${OUTCOME_KEYS[detail.decision.outcome]}`) : detail.decision.outcome}
                  </p>
                  <p className="mt-1">{detail.decision.note}</p>
                </div>

                {detail.decision.requiresHumanReview && (
                  <div className="flex gap-2">
                    {(
                      [
                        { key: "free_recleaning", i18nKey: "freeRecleaning" },
                        { key: "explain_no_action", i18nKey: "explainNoAction" },
                        { key: "dismiss", i18nKey: "dismiss" },
                      ] as { key: "free_recleaning" | "explain_no_action" | "dismiss"; i18nKey: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setFinalAction(opt.key)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                          finalAction === opt.key
                            ? "bg-brand-navy text-white border-brand-navy"
                            : "bg-gray-100 text-gray-600 border-transparent"
                        }`}
                      >
                        {t(`resolveModal.actions.${opt.i18nKey}`)}
                      </button>
                    ))}
                  </div>
                )}

                {selectedClaim.severity === "critical" && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-orange-800">
                      {t("forceCapture.heading")}
                    </p>
                    <textarea
                      aria-label={t("forceCapture.reasonAria")}
                      value={forceCaptureReason}
                      onChange={(e) => setForceCaptureReason(e.target.value)}
                      placeholder={t("forceCapture.reasonPlaceholder")}
                      className="w-full border rounded-lg p-2 text-xs min-h-[50px]"
                    />
                    {forceCaptureError && <p className="text-xs text-red-600">{forceCaptureError}</p>}
                    {forceCaptureResult && <p className="text-xs text-green-700">{forceCaptureResult}</p>}
                    <button
                      type="button"
                      aria-label={t("forceCapture.buttonAria")}
                      onClick={forceFullCapture}
                      disabled={forceCaptureSubmitting}
                      className="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                    >
                      {forceCaptureSubmitting ? t("forceCapture.capturing") : t("forceCapture.button")}
                    </button>
                  </div>
                )}

                <textarea
                  aria-label={t("resolutionNotesAria")}
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder={t("resolutionNotesPlaceholder")}
                  className="w-full border rounded-lg p-3 text-sm min-h-[80px] focus:ring-2 focus:ring-brand-navy focus:border-transparent"
                />

                {detailError && <p className="text-sm text-red-600">{detailError}</p>}

                <button
                  aria-label={t("applyDecisionAria")}
                  onClick={resolveClaim}
                  disabled={submitting}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  ) : detail.decision.requiresHumanReview ? (
                    t("applyDecision")
                  ) : (
                    t("applyAutomaticDecision")
                  )}
                </button>
              </>
            ) : (
              detailError && <p className="text-sm text-red-600">{detailError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
