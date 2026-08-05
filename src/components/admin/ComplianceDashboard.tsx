"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Shield,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Plus,
  RefreshCw,
  X,
  FileWarning,
} from "lucide-react";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

// ---------------------------------------------------------------------------
// Types (aligned with compliance-engine.ts ReglaLegalRow)
// ---------------------------------------------------------------------------

type TipoRegla =
  | "CPP"
  | "EI"
  | "Tax"
  | "GST"
  | "PST"
  | "WorkSafeBC"
  | "MinWage"
  | "VacationPay"
  | "StatutoryHolidays";

type Jurisdiccion = "Federal" | "BC";
type EstadoRegla = "VIGENTE" | "PENDIENTE" | "HISTORICO";

interface ReglaLegal {
  id: string;
  jurisdiccion: Jurisdiccion;
  tipo: TipoRegla;
  version: string;
  parametros: Record<string, unknown>;
  estado: EstadoRegla;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  creado_por: string | null;
  creado_en: string;
  notas: string | null;
}

interface VersionChangeEntry {
  id: string;
  tipo: TipoRegla;
  oldVersion: string;
  newVersion: string;
  changedAt: string;
  changedBy: string;
  motivo: string | null;
}

interface ComplianceAlertType {
  tipo: TipoRegla;
  messageKey: string;
  severity: "info" | "warning";
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIPO_LABELS: Record<TipoRegla, string> = {
  CPP: "CPP",
  EI: "EI",
  Tax: "Income Tax",
  GST: "GST",
  PST: "PST",
  WorkSafeBC: "WorkSafeBC",
  MinWage: "Min. Wage",
  VacationPay: "Vacation Pay",
  StatutoryHolidays: "Statutory Holidays",
};

const ALL_TIPOS: TipoRegla[] = [
  "CPP", "EI", "Tax", "GST", "PST",
  "WorkSafeBC", "MinWage", "VacationPay", "StatutoryHolidays",
];

const ESTADO_BADGE: Record<EstadoRegla, { color: string; icon: React.ReactNode; labelKey: string }> = {
  VIGENTE: {
    color: "bg-green-100 text-green-800 border-green-200",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    labelKey: "statusActive",
  },
  PENDIENTE: {
    color: "bg-amber-100 text-amber-800 border-amber-200",
    icon: <Clock className="w-3.5 h-3.5" />,
    labelKey: "statusPendingReview",
  },
  HISTORICO: {
    color: "bg-red-100 text-red-800 border-red-200",
    icon: <FileWarning className="w-3.5 h-3.5" />,
    labelKey: "statusExpired",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateISO: string, locale: string): string {
  const now = Date.now();
  const then = new Date(dateISO).getTime();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffMinutes = Math.floor(diffMs / (60 * 1000));

  const useEs = locale === "fr" ? "fr" : "en";
  if (diffMinutes < 1) return useEs === "fr" ? "à l'instant" : "just now";
  if (diffMinutes < 60) {
    return useEs === "fr"
      ? `il y a ${diffMinutes} min`
      : `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return useEs === "fr"
      ? `il y a ${diffHours} h`
      : `${diffHours}h ago`;
  }
  if (diffDays === 1) return useEs === "fr" ? "hier" : "1 day ago";
  return useEs === "fr"
    ? `il y a ${diffDays} jours`
    : `${diffDays} days ago`;
}

function formatParamValue(value: unknown): string {
  if (typeof value === "number") {
    // Show as percentage if between 0 and 1
    if (value > 0 && value < 1) return `${(value * 100).toFixed(2)}%`;
    return value.toLocaleString();
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ComplianceDashboard() {
  const t = useTranslations("admin.compliance");
  const locale = useLocale();

  // ── Rules state ───────────────────────────────────────────────────────────
  const [rules, setRules] = useState<ReglaLegal[]>([]);
  const [filterTipo, setFilterTipo] = useState<TipoRegla | "ALL">("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Version history ───────────────────────────────────────────────────────
  const [versionHistory, setVersionHistory] = useState<VersionChangeEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Alerts ────────────────────────────────────────────────────────────────
  const [alerts, setAlerts] = useState<ComplianceAlertType[]>([]);

  // ── "Nueva versión" modal ─────────────────────────────────────────────────
  const [showNewVersionModal, setShowNewVersionModal] = useState(false);
  const [selectedRuleForNewVersion, setSelectedRuleForNewVersion] = useState<ReglaLegal | null>(null);
  const [versioning, setVersioning] = useState(false);
  const [versionError, setVersionError] = useState("");

  // ── Last sync ─────────────────────────────────────────────────────────────
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadRules = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const tipoParam = filterTipo !== "ALL" ? `&tipo=${filterTipo}` : "";
      const res = await fetch(`/api/admin/compliance/rules?${tipoParam}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.message ?? t("errors.loadFailed"));
      setRules(data.rules ?? []);
      setLastSyncAt(data.lastSyncAt ?? null);
      setAlerts(data.alerts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [filterTipo, t]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/admin/compliance/rules/history", {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("errors.historyFailed"));
      setVersionHistory(data.changes ?? []);
    } catch {
      // Silently fail — history is non-critical
    } finally {
      setHistoryLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory, loadHistory]);

  // ── New version handler ───────────────────────────────────────────────────
  const handleNewVersion = useCallback(
    async (values: Record<string, string>) => {
      if (!selectedRuleForNewVersion) return;
      setVersioning(true);
      setVersionError("");
      try {
        const res = await fetch("/api/admin/compliance/rules/new-version", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ruleId: selectedRuleForNewVersion.id,
            newVersion: values.version,
            vigenteDesde: values.vigente_desde,
            notas: values.notas,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? data.message ?? t("errors.versionFailed"));
        setShowNewVersionModal(false);
        setSelectedRuleForNewVersion(null);
        await loadRules();
      } catch (err) {
        setVersionError(err instanceof Error ? err.message : t("errors.network"));
      } finally {
        setVersioning(false);
      }
    },
    [selectedRuleForNewVersion, loadRules, t],
  );

  // ── Filtered rules ────────────────────────────────────────────────────────
  const filteredRules =
    filterTipo === "ALL"
      ? rules
      : rules.filter((r) => r.tipo === filterTipo);

  const activeRules = filteredRules.filter((r) => r.estado === "VIGENTE");
  const pendingRules = filteredRules.filter((r) => r.estado === "PENDIENTE");
  const historicRules = filteredRules.filter((r) => r.estado === "HISTORICO");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Shield className="w-5 h-5" />
          {t("title")}
        </h2>
        <div className="flex items-center gap-3">
          {lastSyncAt && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              {t("lastSync")}: {timeAgo(lastSyncAt, locale)}
            </span>
          )}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm text-brand-navy hover:underline"
            aria-expanded={showHistory}
          >
            <History className="w-4 h-4" />
            {t("versionHistory")}
          </button>
        </div>
      </div>

      {/* ── Alerts ─────────────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert, idx) => (
            <div
              key={`${alert.tipo}-${idx}`}
              className={`flex items-start gap-2 rounded p-3 text-sm border ${
                alert.severity === "warning"
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-blue-50 border-blue-200 text-blue-800"
              }`}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>{TIPO_LABELS[alert.tipo]}:</strong>{" "}
                {t(`alerts.${alert.messageKey}`, { tipo: TIPO_LABELS[alert.tipo] })}
                <span className="block text-xs opacity-70 mt-0.5">
                  {timeAgo(alert.updatedAt, locale)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded p-3 text-sm border bg-red-50 border-red-200 text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={loadRules} className="text-xs underline hover:no-underline">
            {t("retry")}
          </button>
        </div>
      )}

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-gray-600">{t("filterByType")}:</label>
        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value as TipoRegla | "ALL")}
          className="border rounded px-2.5 py-1.5 text-sm bg-white"
        >
          <option value="ALL">{t("filterAll")}</option>
          {ALL_TIPOS.map((tipo) => (
            <option key={tipo} value={tipo}>
              {TIPO_LABELS[tipo]}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-400 ml-auto">
          {t("countSummary", {
            active: activeRules.length,
            pending: pendingRules.length,
            historic: historicRules.length,
          })}
        </span>
      </div>

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center gap-2 p-8 text-sm text-gray-500 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("loading")}
        </div>
      ) : filteredRules.length === 0 ? (
        /* ── Empty ─────────────────────────────────────────────────────── */
        <div className="p-8 text-center text-sm text-gray-500 border rounded-lg">
          {filterTipo === "ALL" ? t("empty") : t("emptyForType", { tipo: TIPO_LABELS[filterTipo] })}
        </div>
      ) : (
        /* ── Rules table ────────────────────────────────────────────────── */
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.tipo")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.jurisdiccion")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.version")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.parametros")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.estado")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.vigencia")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    <span className="sr-only">{t("table.acciones")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.map((rule) => {
                  const badge = ESTADO_BADGE[rule.estado];
                  const isActive = rule.estado === "VIGENTE";
                  const paramKeys = Object.keys(rule.parametros).filter(
                    (k) => rule.parametros[k] !== undefined && rule.parametros[k] !== null,
                  );

                  return (
                    <tr
                      key={rule.id}
                      className={`border-t border-gray-100 hover:bg-gray-50 ${
                        rule.estado === "VIGENTE" ? "" : rule.estado === "HISTORICO" ? "opacity-60" : "bg-amber-50/30"
                      }`}
                    >
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        {TIPO_LABELS[rule.tipo]}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{rule.jurisdiccion}</td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{rule.version}</td>
                      <td className="px-3 py-2 max-w-[200px]">
                        <div className="flex flex-wrap gap-1">
                          {paramKeys.slice(0, 3).map((k) => (
                            <span
                              key={k}
                              className="inline-block px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-700"
                              title={`${k}: ${formatParamValue(rule.parametros[k])}`}
                            >
                              {k}: {formatParamValue(rule.parametros[k])}
                            </span>
                          ))}
                          {paramKeys.length > 3 && (
                            <span className="text-xs text-gray-400">+{paramKeys.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${badge.color}`}
                        >
                          {badge.icon}
                          {t(badge.labelKey)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                        {rule.vigente_desde
                          ? new Date(rule.vigente_desde).toLocaleDateString(
                              locale === "fr" ? "fr-CA" : locale === "zh" ? "zh-CN" : "en-CA",
                            )
                          : "—"}
                        {rule.vigente_hasta && (
                          <>
                            {" → "}
                            {new Date(rule.vigente_hasta).toLocaleDateString(
                              locale === "fr" ? "fr-CA" : locale === "zh" ? "zh-CN" : "en-CA",
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isActive && (
                          <button
                            onClick={() => {
                              setSelectedRuleForNewVersion(rule);
                              setShowNewVersionModal(true);
                              setVersionError("");
                            }}
                            className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline"
                          >
                            <Plus className="w-3 h-3" />
                            {t("newVersionButton")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Version history panel ──────────────────────────────────────────── */}
      {showHistory && (
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <History className="w-4 h-4" />
              {t("historyTitle")}
            </h3>
          </div>

          {historyLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-gray-500 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("loading")}
            </div>
          ) : versionHistory.length === 0 ? (
            <div className="p-6 text-sm text-gray-500 text-center">{t("noHistory")}</div>
          ) : (
            <div className="p-4">
              {/* Vertical timeline */}
              <div className="relative pl-6 border-l-2 border-gray-200 space-y-4">
                {versionHistory.map((entry) => (
                  <div key={entry.id} className="relative">
                    {/* Dot */}
                    <div className="absolute -left-[25px] top-1 w-3 h-3 rounded-full bg-brand-navy border-2 border-white" />
                    <div className="text-sm">
                      <span className="font-medium">{TIPO_LABELS[entry.tipo]}</span>{" "}
                      <span className="text-gray-500">
                        v{entry.oldVersion} → v{entry.newVersion}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {new Date(entry.changedAt).toLocaleString(
                        locale === "fr" ? "fr-CA" : locale === "zh" ? "zh-CN" : "en-CA",
                      )}{" "}
                      · {entry.changedBy}
                    </div>
                    {entry.motivo && (
                      <div className="text-xs text-gray-500 mt-0.5 italic">&quot;{entry.motivo}&quot;</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── "Nueva versión" modal ──────────────────────────────────────────── */}
      {showNewVersionModal && selectedRuleForNewVersion && (
        <ConfirmActionModal
          title={t("newVersionModal.title", {
            tipo: TIPO_LABELS[selectedRuleForNewVersion.tipo],
            version: selectedRuleForNewVersion.version,
          })}
          confirmLabel={versioning ? t("newVersionModal.creating") : t("newVersionModal.create")}
          isConfirming={versioning}
          fields={[
            {
              key: "version",
              label: t("newVersionModal.versionLabel"),
              autoFocus: true,
              required: true,
              helperText: t("newVersionModal.versionHint"),
            },
            {
              key: "vigente_desde",
              label: t("newVersionModal.effectiveDateLabel"),
              type: "text",
              required: true,
            },
            {
              key: "notas",
              label: t("newVersionModal.notesLabel"),
              required: false,
              helperText: t("newVersionModal.notesHint"),
            },
          ]}
          onCancel={() => {
            setShowNewVersionModal(false);
            setSelectedRuleForNewVersion(null);
            setVersionError("");
          }}
          onConfirm={handleNewVersion}
        >
          {versionError && (
            <div className="mt-2 flex items-center gap-2 rounded p-2 text-sm border bg-red-50 border-red-200 text-red-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {versionError}
            </div>
          )}
        </ConfirmActionModal>
      )}
    </div>
  );
}
