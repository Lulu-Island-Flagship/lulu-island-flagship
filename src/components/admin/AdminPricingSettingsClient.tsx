"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, DollarSign, History, AlertCircle, CheckCircle2, Table2 } from "lucide-react";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";
import { formatCurrency } from "@/lib/format";
import { formatVancouverDate } from "@/lib/date-utils";

// Fix (auditoría externa 2026-07-31): mismo techo que el backend
// (src/app/api/admin/hhe-settings/route.ts) -- validar solo en el cliente
// no sirve de nada si el servidor acepta cualquier valor positivo.
const MAX_HHE_VALUE = 50;

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
  const params = useParams();
  const rawLocale = params?.locale as string | undefined;
  const locale = rawLocale && ["en", "zh", "fr"].includes(rawLocale) ? rawLocale : "en";
  const [data, setData] = useState<PricingSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newRate, setNewRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  const [hheTable, setHheTable] = useState<Record<string, number[]> | null>(null);
  // Fix (auditoría externa 2026-07-31): snapshot del último valor cargado
  // del servidor, usado para construir el diff antes/después mostrado en
  // el modal de confirmación de handleHHESubmit.
  const [hheOriginalTable, setHheOriginalTable] = useState<Record<string, number[]> | null>(null);
  const [showHheConfirm, setShowHheConfirm] = useState(false);
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
      setHheOriginalTable(json.table);
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

  // Fix (auditoría externa 2026-07-31): handleHHESubmit guardaba
  // directamente sin mostrar ningún resumen de qué iba a cambiar -- ahora
  // solo valida y abre un ConfirmActionModal con el diff antes/después; el
  // PATCH real ocurre en submitHHE, llamado desde el onConfirm del modal.
  function handleHHESubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hheTable) return;
    setHheError("");
    setHheSuccess("");

    if (!hheReason.trim()) {
      setHheError(t("errors.reasonRequired"));
      return;
    }

    setShowHheConfirm(true);
  }

  async function submitHHE() {
    if (!hheTable) return;
    setHheSaving(true);
    setHheError("");
    try {
      const res = await fetch("/api/admin/hhe-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ table: hheTable, reason: hheReason.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        const message = err.error || t("errors.hheUpdateFailed");
        setHheError(message);
        throw new Error(message);
      }

      const result = (await res.json()) as { message: string };
      setHheSuccess(result.message);
      setHheReason("");
      await loadHHE();
    } catch (err) {
      if (!(err instanceof Error)) setHheError(t("errors.networkError"));
      throw err;
    } finally {
      setHheSaving(false);
    }
  }

  function updateHHECell(serviceType: string, index: number, value: string) {
    if (!hheTable) return;
    const num = parseFloat(value);
    if (Number.isNaN(num) || num <= 0) {
      // Item 10 (auditoría 2026-07-30): antes se descartaba el cambio en
      // silencio si el valor era 0/negativo/no numérico, sin explicar por
      // qué el input no reflejaba lo que el usuario acababa de teclear.
      setHheError(t("errors.hheCellMustBePositive"));
      return;
    }
    if (num > MAX_HHE_VALUE) {
      // Fix (auditoría externa 2026-07-31): sin techo, un typo de una
      // orden de magnitud (ej. 500 en vez de 5.0) se guardaba sin aviso.
      setHheError(t("errors.hheCellExceedsMax", { max: MAX_HHE_VALUE }));
      return;
    }
    setHheError("");
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
            {t("currentRateLabel")} <strong>{formatCurrency(data.current.target_hourly_rate, locale)}/hr</strong>
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
                            max={MAX_HHE_VALUE}
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
                {/* Fix (auditoría externa, hallazgo confirmado): este preview
                    usaba 4 arrays HHE hardcodeados (valores de ejemplo/seed)
                    en vez de leer la tabla `hheTable` ya cargada desde
                    GET /api/admin/hhe-settings (mismo estado que alimenta el
                    formulario editable arriba). Resultado: si el admin
                    cambiaba un valor HHE y lo guardaba, el "preview en vivo"
                    seguía mostrando los precios calculados con los valores
                    viejos de ejemplo -- lo opuesto de lo que promete la
                    palabra "preview". Ahora usa hheTable directamente; si
                    todavía no cargó, no se renderiza esta sección (mismo
                    guard `hheTable &&` que ya usa el formulario editable). */}
                {hheTable && [
                  { key: "regular" as const, label: t("serviceTypes.regular") },
                  { key: "deep" as const, label: t("serviceTypes.deep") },
                  { key: "move_in_out" as const, label: t("serviceTypes.moveInOut") },
                  { key: "post_construction" as const, label: t("serviceTypes.postConstruction") },
                ].map((row) => (
                  <tr key={row.key}>
                    <td className="px-4 py-3 font-medium text-brand-ink">{row.label}</td>
                    {hheTable[row.key].map((hhe, i) => (
                      <td key={i} className="px-4 py-3 text-right text-gray-600">
                        {formatCurrency(Math.round(hhe * data.current!.target_hourly_rate), locale)}
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
                      {formatVancouverDate(log.created_at, "en")}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {log.previous_rate !== null && log.previous_rate !== undefined
                        ? `${formatCurrency(log.previous_rate, locale)}/hr`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-brand-ink">
                      {formatCurrency(log.new_rate, locale)}/hr
                    </td>
                    <td className="px-4 py-3 text-gray-600">{log.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showHheConfirm && hheTable && (
        <ConfirmActionModal
          title={t("hheTable.confirmTitle")}
          message={
            <span className="space-y-1 block">
              {(() => {
                const rows = [
                  { key: "regular", label: t("serviceTypes.regular") },
                  { key: "deep", label: t("serviceTypes.deep") },
                  { key: "move_in_out", label: t("serviceTypes.moveInOut") },
                  { key: "post_construction", label: t("serviceTypes.postConstruction") },
                ];
                const diffs: string[] = [];
                for (const row of rows) {
                  const before = hheOriginalTable?.[row.key];
                  const after = hheTable[row.key];
                  after.forEach((v, i) => {
                    const prev = before?.[i];
                    if (prev !== undefined && prev !== v) {
                      diffs.push(`${row.label} (${hheRangeLabels[i]}): ${prev} → ${v}`);
                    }
                  });
                }
                if (diffs.length === 0) {
                  return <span>{t("hheTable.confirmNoChanges")}</span>;
                }
                return diffs.map((d) => (
                  <span key={d} className="block font-mono text-xs">{d}</span>
                ));
              })()}
            </span>
          }
          confirmLabel={t("hheTable.saveButton")}
          onCancel={() => setShowHheConfirm(false)}
          onConfirm={async () => {
            await submitHHE();
            setShowHheConfirm(false);
          }}
        />
      )}
    </div>
  );
}
