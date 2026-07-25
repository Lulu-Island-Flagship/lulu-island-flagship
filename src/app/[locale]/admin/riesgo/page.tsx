"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert, Loader2, Plus, AlertOctagon } from "lucide-react";

// v8.3 E7 (D.7.7) — Pre-evaluación de riesgo por dirección.
// Visible a admin y líder, NUNCA al cliente (regla explícita del spec).
// Nunca visible al cliente: esta ruta vive solo bajo /admin.

type RiskFlagType =
  | "steep_stairs"
  | "aggressive_dog"
  | "mold_over_1sqm"
  | "confined_space"
  | "defective_lockbox";

type RiskTier = "standard" | "auditor_required" | "pre_inspection_required";

interface RiskAssessment {
  id: string;
  client_property_id: string;
  flags: RiskFlagType[];
  flag_count: number;
  tier: RiskTier;
  hard_blocked: boolean;
  notes: string | null;
  created_at: string;
}

const FLAG_KEYS: RiskFlagType[] = [
  "steep_stairs",
  "aggressive_dog",
  "mold_over_1sqm",
  "confined_space",
  "defective_lockbox",
];

const TIER_COLORS: Record<RiskTier, string> = {
  standard: "bg-gray-100 text-gray-700",
  auditor_required: "bg-yellow-100 text-yellow-800",
  pre_inspection_required: "bg-red-100 text-red-800",
};

export default function RiesgoPage() {
  const t = useTranslations("admin.riesgo");
  const [propertyId, setPropertyId] = useState("");
  const [selectedFlags, setSelectedFlags] = useState<RiskFlagType[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [lookupPropertyId, setLookupPropertyId] = useState("");
  const [assessments, setAssessments] = useState<RiskAssessment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAssessments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAssessments(propId?: string) {
    setLoading(true);
    try {
      const url = propId
        ? `/api/admin/risk-assessments?propertyId=${propId}`
        : "/api/admin/risk-assessments";
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAssessments(data.assessments || []);
      }
    } finally {
      setLoading(false);
    }
  }

  function toggleFlag(flag: RiskFlagType) {
    setSelectedFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!propertyId.trim()) {
      setError(t("errors.missingPropertyId"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/risk-assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientPropertyId: propertyId.trim(), flags: selectedFlags }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("errors.saveFailed"));
        return;
      }
      setSelectedFlags([]);
      await loadAssessments(lookupPropertyId || undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-5 h-5 text-brand-navy" />
          <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">{t("subtitle")}</p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3 mb-6">
          <h2 className="text-sm font-semibold text-brand-ink">{t("recordAssessment")}</h2>
          <input
            type="text"
            aria-label={t("propertyIdAria")}
            placeholder={t("propertyIdPlaceholder")}
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="w-full text-sm border rounded-lg px-3 py-2"
          />
          <div className="space-y-2">
            {FLAG_KEYS.map((f) => (
              <label key={f} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={t(`flags.${f}`)}
                  checked={selectedFlags.includes(f)}
                  onChange={() => toggleFlag(f)}
                  className="mt-0.5"
                />
                <span className={f === "mold_over_1sqm" ? "text-state-danger font-medium" : "text-gray-700"}>
                  {t(`flags.${f}`)}
                </span>
              </label>
            ))}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> {t("recordAssessment")}
          </button>
        </form>

        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            aria-label={t("filterAria")}
            placeholder={t("filterPlaceholder")}
            value={lookupPropertyId}
            onChange={(e) => setLookupPropertyId(e.target.value)}
            className="flex-1 text-sm border rounded-lg px-3 py-2"
          />
          <button
            onClick={() => loadAssessments(lookupPropertyId || undefined)}
            className="text-sm bg-white border px-3 py-2 rounded-lg font-medium text-brand-navy"
          >
            {t("search")}
          </button>
        </div>

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
        ) : (
          <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
            {assessments.length === 0 && (
              <p className="p-4 text-sm text-gray-500">{t("emptyState")}</p>
            )}
            {assessments.map((a) => (
              <div key={a.id} className="p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-gray-500">{a.client_property_id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${TIER_COLORS[a.tier]}`}>
                    {t(`tiers.${a.tier}`)}
                  </span>
                </div>
                {a.hard_blocked && (
                  <p className="text-xs text-state-danger font-medium mt-1 flex items-center gap-1">
                    <AlertOctagon className="w-3.5 h-3.5" /> {t("blockedNotice")}
                  </p>
                )}
                {a.notes && <p className="text-xs text-gray-600 mt-1">{a.notes}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(a.created_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
