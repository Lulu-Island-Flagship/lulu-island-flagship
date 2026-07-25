"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, DollarSign, History, AlertCircle, CheckCircle2, Table2 } from "lucide-react";

interface PricingSetting {
  id: string;
  target_hourly_rate: number;
  effective_from: string;
  effective_to?: string | null;
  reason?: string;
  created_at: string;
}

interface PricingAuditLog {
  id: string;
  previous_rate?: number | null;
  new_rate: number;
  previous_effective_from?: string | null;
  new_effective_from: string;
  reason: string;
  created_at: string;
}

interface PricingSettingsData {
  current: PricingSetting | null;
  history: PricingAuditLog[];
  fallbackRate: number;
}

export default function AdminPricingSettingsClient() {
  const t = useTranslations("admin.pricingSettings");
  const [data, setData] = useState<PricingSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newRate, setNewRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  const [hheTable, setHheTable] = useState<Record<string, number[]> | null>(null);
  const [hheRangeLabels, setHheRangeLabels] = useState<string[]>([
    "≤ 700 ft²", "700 – 1,500 ft²", "1,500 – 2,500 ft²", "2,500 – 3,500 ft²", "> 3,500 ft²",
  ]);
  const [hheReason, setHheReason] = useState("");
  const [hheSaving, setHheSaving] = useState(false);
  const [hheSuccess, setHheSuccess] = useState("");
  const [hheError, setHheError] = useState("");

  useEffect(() => {
    loadSettings();
    loadHHE();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pricing-settings", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const json = (await res.json()) as PricingSettingsData;
      setData(json);
      if (json.current) {
        setNewRate(String(json.current.target_hourly_rate));
      }
    } catch {
      setError(t("errors.networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function loadHHE() {
    setHheError("");
    try {
      const res = await fetch("/api/admin/hhe-settings", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setHheError(err.error || t("errors.hheLoadFailed"));
        return;
      }
      const json = (await res.json()) as { table: Record<string, number[]>; rangeLabels: string[] };
      setHheTable(json.table);
      setHheRangeLabels(json.rangeLabels);
    } catch {
      setHheError(t("errors.hheNetworkError"));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    const rateNum = parseFloat(newRate);
    if (!rateNum || rateNum <= 0) {
      setError(t("errors.rateMustBePositive"));
      setSaving(false);
      return;
    }

    if (!reason.trim()) {
      setError(t("errors.reasonRequired"));
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/admin/pricing-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          targetHourlyRate: rateNum,
          effectiveFrom: effectiveFrom || undefined,
          reason: reason.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.updateFailed"));
        return;
      }

      const result = (await res.json()) as { message: string };
      setSuccess(result.message);
      setReason("");
      await loadSettings();
    } catch {
      setError(t("errors.networkError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleHHESubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hheTable) return;
    setHheSaving(true);
    setHheError("");
    setHheSuccess("");

    if (!hheReason.trim()) {
      setHheError(t("errors.reasonRequired"));
      setHheSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/admin/hhe-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ table: hheTable, reason: hheReason.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        setHheError(err.error || t("errors.hheUpdateFailed"));
        return;
      }

      const result = (await res.json()) as { message: string };
      setHheSuccess(result.message);
      setHheReason("");
      await loadHHE();
    } catch {
      setHheError(t("errors.networkError"));
    } finally {
      setHheSaving(false);
    }
  }

  function updateHHECell(serviceType: string, index: number, value: string) {
    if (!hheTable) return;
    const num = parseFloat(value);
    if (Number.isNaN(num) || num <= 0) return;
    setHheTable({
      ...hheTable,
      [serviceType]: hheTable[serviceType].map((v, i) => (i === index ? num : v)),
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        {data?.current && (
          <span className="text-sm text-gray-500">
            {t("currentRateLabel")} <strong>${data.current.target_hourly_rate}/hr</strong>
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <p className="text-green-700 text-sm">{success}</p>
        </div>
      )}

      {/* Current rate card */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-brand-gold/10 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-brand-gold" />
          </div>
          <div>
            <h2 className="font-semibold text-brand-ink">{t("targetRate.title")}</h2>
            <p className="text-sm text-gray-500">
              {t("targetRate.description")}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="pricing-new-rate" className="block text-sm font-medium text-brand-ink mb-1">
                {t("targetRate.newRateLabel")}
              </label>
              <input
                id="pricing-new-rate"
                type="number"
                min="1"
                step="0.01"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
                placeholder="70.00"
                required
              />
            </div>
            <div>
              <label htmlFor="pricing-effective-from" className="block text-sm font-medium text-brand-ink mb-1">
                {t("targetRate.effectiveFromLabel")}
              </label>
              <input
                id="pricing-effective-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">{t("targetRate.effectiveFromHint")}</p>
            </div>
            <div>
              <label htmlFor="pricing-rate-reason" className="block text-sm font-medium text-brand-ink mb-1">
                {t("targetRate.reasonLabel")}
              </label>
              <input
                id="pricing-rate-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
                placeholder={t("targetRate.reasonPlaceholder")}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 bg-brand-navy text-white px-6 py-2.5 rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("targetRate.updateButton")}
          </button>
        </form>
      </div>

      {/* Editable HHE table */}
      {hheTable && (
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-brand-gold/10 flex items-center justify-center">
              <Table2 className="w-5 h-5 text-brand-gold" />
            </div>
            <div>
              <h2 className="font-semibold text-brand-ink">{t("hheTable.title")}</h2>
              <p className="text-sm text-gray-500">
                {t("hheTable.description")}
              </p>
            </div>
          </div>

          {hheError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 mb-4">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm">{hheError}</p>
            </div>
          )}

          {hheSuccess && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3 mb-4">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <p className="text-green-700 text-sm">{hheSuccess}</p>
            </div>
          )}

          <form onSubmit={handleHHESubmit} className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("hheTable.serviceTypeHeader")}</th>
                    {hheRangeLabels.map((label) => (
                      <th key={label} scope="col" className="text-right px-4 py-3 font-medium text-gray-600">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[
                    { key: "regular", label: t("serviceTypes.regular") },
                    { key: "deep", label: t("serviceTypes.deep") },
                    { key: "move_in_out", label: t("serviceTypes.moveInOut") },
                    { key: "post_construction", label: t("serviceTypes.postConstruction") },
                  ].map((row) => (
                    <tr key={row.key}>
                      <td className="px-4 py-3 font-medium text-brand-ink">{row.label}</td>
                      {hheTable[row.key].map((value, i) => (
                        <td key={i} className="px-4 py-3">
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            aria-label={t("hheTable.cellAriaLabel", { serviceType: row.label, range: hheRangeLabels[i] })}
                            value={value}
                            onChange={(e) => updateHHECell(row.key, i, e.target.value)}
                            className="w-20 ml-auto block px-2 py-1 rounded border border-gray-200 text-right focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-end gap-4">
              <div className="flex-1">
                <label htmlFor="hhe-reason" className="block text-sm font-medium text-brand-ink mb-1">
                  {t("targetRate.reasonLabel")}
                </label>
                <input
                  id="hhe-reason"
                  type="text"
                  value={hheReason}
                  onChange={(e) => setHheReason(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
                  placeholder={t("hheTable.reasonPlaceholder")}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={hheSaving}
                className="inline-flex items-center gap-2 bg-brand-navy text-white px-6 py-2.5 rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
              >
                {hheSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("hheTable.saveButton")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Live price table preview */}
      {data?.current && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-brand-ink mb-4">{t("preview.title")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("hheTable.serviceTypeHeader")}</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-gray-600">≤700 ft²</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-gray-600">700–1,500</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-gray-600">1,500–2,500</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-gray-600">2,500–3,500</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-gray-600">&gt;3,500</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[
                  { key: "regular" as const, label: t("serviceTypes.regular"), hhe: [1.5, 2.5, 4.0, 6.0, 8.0] },
                  { key: "deep" as const, label: t("serviceTypes.deep"), hhe: [2.5, 4.0, 6.5, 9.0, 12.0] },
                  { key: "move_in_out" as const, label: t("serviceTypes.moveInOut"), hhe: [3.0, 5.0, 8.0, 11.0, 15.0] },
                  { key: "post_construction" as const, label: t("serviceTypes.postConstruction"), hhe: [4.0, 6.5, 10.0, 14.0, 18.0] },
                ].map((row) => (
                  <tr key={row.key}>
                    <td className="px-4 py-3 font-medium text-brand-ink">{row.label}</td>
                    {row.hhe.map((hhe, i) => (
                      <td key={i} className="px-4 py-3 text-right text-gray-600">
                        ${Math.round(hhe * data.current!.target_hourly_rate).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audit history */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center gap-3 mb-4">
          <History className="w-5 h-5 text-brand-wave-blue" />
          <h2 className="font-semibold text-brand-ink">{t("history.title")}</h2>
        </div>

        {data && data.history.length === 0 ? (
          <p className="text-sm text-gray-500">{t("history.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("history.dateHeader")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("history.previousHeader")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("history.newHeader")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("history.reasonHeader")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.history.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(log.created_at).toLocaleDateString("en-CA")}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {log.previous_rate !== null && log.previous_rate !== undefined
                        ? `$${log.previous_rate}/hr`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-brand-ink">
                      ${log.new_rate}/hr
                    </td>
                    <td className="px-4 py-3 text-gray-600">{log.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
