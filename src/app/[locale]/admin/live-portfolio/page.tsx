"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2, CheckCircle2, XCircle, Images } from "lucide-react";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";
import { useTranslations } from "next-intl";

interface Candidate {
  id: string;
  order_id: string;
  zone: string;
  service_subtype: string;
  anonymous_label: string;
  checklist_completion_percent: number;
  employee_score_at_selection: number;
  candidate_photo_urls: string[];
  status: string;
}

/**
 * v8.3 E5.15 — Live Portfolio: cola de candidatos surfaceados
 * automáticamente (checklist 100%, sin flags, score ≥80, consentimiento).
 * El admin juzga la diferencia visual antes/después y aprueba de UN toque.
 */
export default function LivePortfolioAdminPage() {
  const t = useTranslations("admin.livePortfolio");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<Record<string, string>>({});
  // Item 12 (auditoría 2026-07-25): "Reject" descartaba un candidato
  // permanentemente sin ninguna confirmación -- un solo clic accidental
  // perdía el candidato. Se agrega ConfirmActionModal (mismo patrón ya usado
  // en AdminRolesClient.tsx y otros) antes de ejecutar el reject.
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/live-portfolio?status=candidate", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorLoading"));
        return;
      }
      const data = await res.json();
      setCandidates(data.candidates || []);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }

  async function act(id: string, action: "approve" | "reject") {
    setActing(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/live-portfolio/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, selectedPhotoUrl: selectedPhoto[id] }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorUpdating"));
        return;
      }
      await load();
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <Images className="w-6 h-6" /> {t("title")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {candidates.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-sm text-gray-500">
          {t("empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {candidates.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-brand-ink">{c.anonymous_label}</p>
                  <p className="text-xs text-gray-500">
                    {t("checklistScore", {
                      checklist: c.checklist_completion_percent,
                      score: c.employee_score_at_selection,
                    })}
                  </p>
                </div>
              </div>

              {c.candidate_photo_urls.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {c.candidate_photo_urls.map((url) => (
                    <button
                      key={url}
                      onClick={() => setSelectedPhoto((prev) => ({ ...prev, [c.id]: url }))}
                      className={`rounded-lg overflow-hidden border-2 ${
                        (selectedPhoto[c.id] || c.candidate_photo_urls[0]) === url
                          ? "border-brand-gold"
                          : "border-transparent"
                      }`}
                    >
                      <div className="relative aspect-square">
                        <Image src={url} alt="Candidate" fill unoptimized sizes="150px" className="object-cover" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => act(c.id, "approve")}
                  disabled={acting === c.id}
                  className="inline-flex items-center gap-1.5 text-sm font-medium bg-brand-navy text-white px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> {t("approve")}
                </button>
                <button
                  onClick={() => setPendingRejectId(c.id)}
                  disabled={acting === c.id}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 border border-gray-200 px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> {t("reject")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingRejectId && (
        <ConfirmActionModal
          title={t("rejectModalTitle")}
          message={t("rejectModalMessage")}
          confirmLabel={t("reject")}
          danger
          onCancel={() => setPendingRejectId(null)}
          onConfirm={async () => {
            await act(pendingRejectId, "reject");
            setPendingRejectId(null);
          }}
        />
      )}
    </div>
  );
}
