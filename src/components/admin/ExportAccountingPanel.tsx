"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Download,
  Loader2,
  AlertTriangle,
  FileText,
  History,
  RefreshCw,
  CheckCircle2,
  Eye,
  X,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportFormat = "csv" | "iif" | "pdf" | "json";

interface ExportPeriod {
  year: number;
  month: number; // 1‑based
}

interface ExportPreviewRow {
  date: string;
  description: string;
  account: string;
  debitCents: number;
  creditCents: number;
}

interface ExportHistoryEntry {
  id: string;
  period: string; // "YYYY-MM"
  format: ExportFormat;
  downloadedAt: string;
  filename: string;
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCad(cents: number, locale: string): string {
  return formatCurrency(cents / 100, locale);
}

function periodLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthName(month: number, locale: string): string {
  const d = new Date(2024, month - 1, 1);
  return d.toLocaleString(locale === "fr" ? "fr-CA" : locale === "zh" ? "zh-CN" : "en-CA", { month: "long" });
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  iif: "IIF (QuickBooks)",
  pdf: "PDF",
  json: "JSON",
};

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  csv: ".csv",
  iif: ".iif",
  pdf: ".pdf",
  json: ".json",
};

const _FORMAT_MIME: Record<ExportFormat, string> = {
  csv: "text/csv",
  iif: "text/plain",
  pdf: "application/pdf",
  json: "application/json",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExportAccountingPanel() {
  const t = useTranslations("admin.exportAccounting");
  const locale = useLocale();
  // ── State ─────────────────────────────────────────────────────────────────
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [period, setPeriod] = useState<ExportPeriod>({ year: currentYear, month: currentMonth });
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Preview
  const [previewRows, setPreviewRows] = useState<ExportPreviewRow[]>([]);
  const [previewTotalRows, setPreviewTotalRows] = useState(0);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // History
  const [history, setHistory] = useState<ExportHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  // ── Loaders ───────────────────────────────────────────────────────────────

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewLoaded(false);
    setError("");
    try {
      const params = new URLSearchParams({
        year: String(period.year),
        month: String(period.month),
        format,
        preview: "true",
        limit: "10",
      });
      const res = await fetch(`/api/admin/export/accounting?${params}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || t("errors.previewFailed"));
      setPreviewRows(data.previewRows ?? []);
      setPreviewTotalRows(data.totalRows ?? 0);
      setPreviewLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setPreviewLoading(false);
    }
  }, [period.year, period.month, format, t]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await fetch("/api/admin/export/accounting/history", {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errors.historyFailed"));
      setHistory(data.exports ?? []);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setHistoryLoading(false);
    }
  }, [t]);

  // ── Load preview when period or format changes ────────────────────────────
  useEffect(() => {
    loadPreview();
  }, [period.year, period.month, format, loadPreview]);

  // ── Load history on mount ─────────────────────────────────────────────────
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ── Auto-dismiss success message ──────────────────────────────────────────
  useEffect(() => {
    if (!successMsg) return;
    const id = setTimeout(() => setSuccessMsg(""), 4000);
    return () => clearTimeout(id);
  }, [successMsg]);

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError("");
    setSuccessMsg("");
    try {
      const params = new URLSearchParams({
        year: String(period.year),
        month: String(period.month),
        format,
      });
      const res = await fetch(`/api/admin/export/accounting?${params}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.message ?? errData?.error ?? t("errors.exportFailed"));
      }

      // Download via blob
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename =
        filenameMatch?.[1] ??
        `accounting-${periodLabel(period.year, period.month)}${FORMAT_EXTENSIONS[format]}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccessMsg(t("exportSuccess", { filename }));
      // Refresh history
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.exportFailed"));
    } finally {
      setExporting(false);
    }
  }, [period, format, t, loadHistory]);

  // ── Period navigation ─────────────────────────────────────────────────────

  const goToPreviousMonth = useCallback(() => {
    setPeriod((p) => {
      if (p.month === 1) return { year: p.year - 1, month: 12 };
      return { year: p.year, month: p.month - 1 };
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setPeriod((p) => {
      if (p.month === 12) return { year: p.year + 1, month: 1 };
      return { year: p.year, month: p.month + 1 };
    });
  }, []);

  const isCurrentPeriod =
    period.year === currentYear && period.month === currentMonth;

  // ── Years list ────────────────────────────────────────────────────────────

  const yearOptions: number[] = [];
  for (let y = 2025; y <= currentYear + 1; y++) yearOptions.push(y);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileText className="w-5 h-5" />
          {t("title")}
        </h2>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm text-brand-navy hover:underline"
          aria-expanded={showHistory}
        >
          <History className="w-4 h-4" />
          {t("historyToggle")}
        </button>
      </div>
      <p className="text-sm text-gray-500 -mt-4">{t("subtitle")}</p>

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-2 rounded p-3 text-sm border bg-red-50 border-red-200 text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button
            onClick={() => setError("")}
            aria-label={t("dismiss")}
            className="shrink-0 hover:opacity-70"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Success toast ───────────────────────────────────────────────── */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded p-3 text-sm border bg-green-50 border-green-200 text-green-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* ── Controls row ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-4 p-4 bg-gray-50 rounded-lg border">
        {/* Period selector */}
        <div>
          <label htmlFor="export-year" className="block text-xs font-medium text-gray-500 mb-1">
            {t("periodLabel")}
          </label>
          <div className="flex items-center gap-1">
            <button
              onClick={goToPreviousMonth}
              className="p-1.5 rounded hover:bg-gray-200"
              aria-label={t("previousMonth")}
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </button>
            <select
              id="export-year"
              value={period.year}
              onChange={(e) => setPeriod((p) => ({ ...p, year: parseInt(e.target.value, 10) }))}
              className="border rounded px-2 py-1.5 text-sm bg-white"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select
              value={period.month}
              onChange={(e) => setPeriod((p) => ({ ...p, month: parseInt(e.target.value, 10) }))}
              className="border rounded px-2 py-1.5 text-sm bg-white"
              aria-label={t("monthAriaLabel")}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthName(m, locale)}
                </option>
              ))}
            </select>
            <button
              onClick={goToNextMonth}
              disabled={isCurrentPeriod}
              className={`p-1.5 rounded ${isCurrentPeriod ? "opacity-30 cursor-not-allowed" : "hover:bg-gray-200"}`}
              aria-label={t("nextMonth")}
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* Format selector */}
        <div>
          <label htmlFor="export-format" className="block text-xs font-medium text-gray-500 mb-1">
            {t("formatLabel")}
          </label>
          <select
            id="export-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className="border rounded px-2 py-1.5 text-sm bg-white"
          >
            {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </div>

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 px-5 py-2 bg-brand-navy text-white text-sm font-medium rounded hover:bg-brand-navy/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {exporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("exporting")}
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              {t("exportButton")}
            </>
          )}
        </button>
      </div>

      {/* ── Preview section ─────────────────────────────────────────────── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Eye className="w-4 h-4" />
            {t("preview")}
            {previewLoaded && previewTotalRows > 0 && (
              <span className="text-xs font-normal text-gray-500">
                ({t("showingFirstN", { count: Math.min(10, previewTotalRows), total: previewTotalRows })})
              </span>
            )}
          </h3>
          <button
            onClick={loadPreview}
            disabled={previewLoading}
            className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-50"
            aria-label={t("refreshPreview")}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${previewLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {previewLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("loadingPreview")}
          </div>
        ) : !previewLoaded ? (
          <div className="p-6 text-sm text-gray-500">{t("noPreview")}</div>
        ) : previewRows.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">{t("emptyPeriod")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.date")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.description")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.account")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    {t("table.debit")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    {t("table.credit")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => (
                  <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{row.date}</td>
                    <td className="px-3 py-2">{row.description}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{row.account}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.debitCents > 0 ? formatCad(row.debitCents, locale) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.creditCents > 0 ? formatCad(row.creditCents, locale) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Export history ──────────────────────────────────────────────── */}
      {showHistory && (
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <History className="w-4 h-4" />
              {t("historyTitle")}
            </h3>
            <button
              onClick={loadHistory}
              disabled={historyLoading}
              className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-50"
              aria-label={t("refreshHistory")}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {historyLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("loading")}
            </div>
          ) : historyError ? (
            <div className="p-6 text-sm text-red-600">{historyError}</div>
          ) : history.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">{t("noHistory")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {t("historyTable.period")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {t("historyTable.format")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {t("historyTable.filename")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                      {t("historyTable.rows")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {t("historyTable.downloadedAt")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">{entry.period}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-gray-100 font-mono">
                          {entry.format.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-gray-600">{entry.filename}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{entry.rowCount}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                        {new Date(entry.downloadedAt).toLocaleString(
                          locale === "fr" ? "fr-CA" : locale === "zh" ? "zh-CN" : "en-CA"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
