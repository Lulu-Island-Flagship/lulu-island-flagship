"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Loader2, Video, Award, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";

interface Feature {
  id: string;
  employeeName: string;
  feature_type: "day_in_life_reel" | "public_badge_showcase";
  employee_consented_at: string | null;
  employee_consent_withdrawn_at: string | null;
  admin_approved_at: string | null;
  asset_url: string | null;
  visibility: "not_visible_awaiting_consent" | "not_visible_awaiting_admin_approval" | "not_visible_consent_withdrawn" | "visible";
}

const VIS_ICON: Record<Feature["visibility"], { className: string; icon: typeof CheckCircle2 }> = {
  not_visible_awaiting_consent: { className: "text-gray-500 bg-gray-50", icon: Clock },
  not_visible_awaiting_admin_approval: { className: "text-amber-600 bg-amber-50", icon: Clock },
  not_visible_consent_withdrawn: { className: "text-state-danger bg-red-50", icon: XCircle },
  visible: { className: "text-state-success bg-green-50", icon: CheckCircle2 },
};

const FEATURE_ICON: Record<Feature["feature_type"], typeof Video> = {
  day_in_life_reel: Video,
  public_badge_showcase: Award,
};

export default function EmployeeMarketingPage() {
  const t = useTranslations("admin.employeeMarketing");
  const locale = useLocale();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/employee-marketing", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorLoading"));
        return;
      }
      const data = await res.json();
      setFeatures(data.features || []);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(featureId: string) {
    setBusyId(featureId);
    try {
      const res = await fetch("/api/admin/employee-marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "approve", featureId }),
      });
      if (res.ok) await load();
      else {
        const err = await res.json();
        setError(err.error || t("errorApproving"));
      }
    } finally {
      setBusyId(null);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {features.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Video className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">{t("empty")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border divide-y">
          {features.map((f) => {
            const vis = VIS_ICON[f.visibility];
            const VisIcon = vis.icon;
            const FtIcon = FEATURE_ICON[f.feature_type];
            return (
              <div key={f.id} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FtIcon className="w-5 h-5 text-brand-navy shrink-0" />
                  <div>
                    <p className="font-medium text-brand-ink text-sm">
                      {f.employeeName} — {t(`featureType.${f.feature_type}`)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {f.employee_consented_at
                        ? t("consentedOn", { date: new Date(f.employee_consented_at).toLocaleDateString(locale) })
                        : t("noConsentYet")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${vis.className}`}>
                    <VisIcon className="w-3.5 h-3.5" /> {t(`visibility.${f.visibility}`)}
                  </span>
                  {f.visibility === "not_visible_awaiting_admin_approval" && (
                    <button
                      onClick={() => approve(f.id)}
                      disabled={busyId === f.id}
                      className="bg-brand-navy text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                    >
                      {busyId === f.id ? t("approving") : t("approve")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
