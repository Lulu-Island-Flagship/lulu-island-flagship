"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Banknote,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Plus,
  RefreshCw,
  X,
  Receipt,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

// ---------------------------------------------------------------------------
// Types (aligned with payroll-remittance.ts RemesaFiscal)
// ---------------------------------------------------------------------------

type RemesaTipo = "PD7A" | "GST" | "WorkSafeBC";
type RemesaEstado = "pendiente" | "pagado" | "vencido";

interface RemesaFiscal {
  remesa_id: string;
  ciclo_id: string | null;
  tipo: RemesaTipo;
  periodo: string; // "YYYY-MM"
  monto_total: number; // centavos
  fecha_vencimiento: string; // "YYYY-MM-DD"
  fecha_pago: string | null; // "YYYY-MM-DD"
  estado: RemesaEstado;
  comprobante_cra: string | null;
  creado_en: string;
  actualizado_en: string;
}

interface PaymentRecord {
  id: string;
  remesa_id: string;
  fecha_pago: string;
  monto_cents: number;
  comprobante: string | null;
  tipo: RemesaTipo;
  periodo: string;
}

interface Pd7aPreviewData {
  periodoInicio: string;
  periodoFin: string;
  fechaVencimiento: string;
  businessNumber: string;
  employeeCount: number;
  grossPayrollCents: number;
  cppEmployeeCents: number;
  cppEmployerCents: number;
  eiEmployeeCents: number;
  eiEmployerCents: number;
  taxTotalCents: number;
  totalRemittanceCents: number;
  quincena: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIPO_LABELS: Record<RemesaTipo, string> = {
  PD7A: "PD7A",
  GST: "GST",
  WorkSafeBC: "WorkSafeBC",
};

const ESTADO_BADGE: Record<RemesaEstado, { color: string; icon: React.ReactNode; labelKey: string }> = {
  pagado: {
    color: "bg-green-100 text-green-800 border-green-200",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    labelKey: "statusPaid",
  },
  pendiente: {
    color: "bg-amber-100 text-amber-800 border-amber-200",
    icon: <Clock className="w-3.5 h-3.5" />,
    labelKey: "statusDue",
  },
  vencido: {
    color: "bg-red-100 text-red-800 border-red-200",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    labelKey: "statusOverdue",
  },
};

function formatCad(cents: number, locale: string): string {
  return formatCurrency(cents / 100, locale);
}

function isOverdue(fechaVencimiento: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${fechaVencimiento}T00:00:00.000`);
  return due < today;
}

function daysUntilDue(fechaVencimiento: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${fechaVencimiento}T00:00:00.000`);
  return Math.ceil((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PayrollRemittancePanel() {
  const t = useTranslations("admin.payrollRemittances");
  const locale = useLocale();
  const downloadRef = useRef<HTMLAnchorElement>(null);

  // ── Remittances ───────────────────────────────────────────────────────────
  const [remesas, setRemesas] = useState<RemesaFiscal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Payment records ───────────────────────────────────────────────────────
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [showPayments, setShowPayments] = useState(false);

  // ── PD7A generation ───────────────────────────────────────────────────────
  const [generatingPd7a, setGeneratingPd7a] = useState(false);
  const [pd7aPreview, setPd7aPreview] = useState<Pd7aPreviewData | null>(null);
  const [showPd7aPreview, setShowPd7aPreview] = useState(false);
  const [pd7aError, setPd7aError] = useState("");

  // ── Mark as paid modal ────────────────────────────────────────────────────
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [markPaidError, setMarkPaidError] = useState("");

  // ── Download anchor ───────────────────────────────────────────────────────
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadRemesas = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/payroll/remittances", {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.message ?? t("errors.loadFailed"));
      setRemesas(data.remesas ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadPayments = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/payroll/remittances/payments", {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) setPayments(data.payments ?? []);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    loadRemesas();
  }, [loadRemesas]);

  useEffect(() => {
    if (showPayments) loadPayments();
  }, [showPayments, loadPayments]);

  // ── Generate PD7A ─────────────────────────────────────────────────────────
  const handleGeneratePd7a = useCallback(async () => {
    setGeneratingPd7a(true);
    setPd7aError("");
    try {
      const res = await fetch("/api/admin/payroll/remittances/generate-pd7a", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.message ?? t("errors.generatePd7aFailed"));
      setPd7aPreview(data.pd7a ?? null);
      setShowPd7aPreview(true);
    } catch (err) {
      setPd7aError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setGeneratingPd7a(false);
    }
  }, [t]);

  // ── Download remittance file ──────────────────────────────────────────────
  const handleDownload = useCallback(
    async (remesaId: string) => {
      setDownloadingId(remesaId);
      try {
        const res = await fetch(`/api/admin/payroll/remittances/${remesaId}/download`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(t("errors.downloadFailed"));
        const blob = await res.blob();
        const disposition = res.headers.get("content-disposition") ?? "";
        const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
        const filename = filenameMatch?.[1] ?? `remesa-${remesaId}.pdf`;

        const url = URL.createObjectURL(blob);
        const a = downloadRef.current;
        if (a) {
          a.href = url;
          a.download = filename;
          a.click();
        }
        URL.revokeObjectURL(url);
      } catch {
        // silently fail
      } finally {
        setDownloadingId(null);
      }
    },
    [t],
  );

  // ── Mark as paid ──────────────────────────────────────────────────────────
  const handleMarkPaid = useCallback(
    async (values: Record<string, string>) => {
      if (!markPaidId) return;
      setMarkingPaid(true);
      setMarkPaidError("");
      try {
        const amountCents = values.amount ? Math.round(parseFloat(values.amount) * 100) : undefined;
        const res = await fetch(`/api/admin/payroll/remittances/${markPaidId}/pay`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            fechaPago: values.fecha_pago,
            amountCents,
            comprobante: values.comprobante,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? data.message ?? t("errors.payFailed"));
        setMarkPaidId(null);
        await loadRemesas();
      } catch (err) {
        setMarkPaidError(err instanceof Error ? err.message : t("errors.network"));
      } finally {
        setMarkingPaid(false);
      }
    },
    [markPaidId, loadRemesas, t],
  );

  // ── Sort: overdue first, then closest due date ────────────────────────────
  const sorted = [...remesas].sort((a, b) => {
    const aOverdue = isOverdue(a.fecha_vencimiento) ? 0 : 1;
    const bOverdue = isOverdue(b.fecha_vencimiento) ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    return a.fecha_vencimiento.localeCompare(b.fecha_vencimiento);
  });

  const pendingCount = remesas.filter((r) => r.estado !== "pagado").length;
  const overdueCount = sorted.filter((r) => r.estado !== "pagado" && isOverdue(r.fecha_vencimiento)).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Hidden download anchor */}
      <a ref={downloadRef} className="hidden" aria-hidden="true" />

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Banknote className="w-5 h-5" />
          {t("title")}
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPayments((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm text-brand-navy hover:underline"
            aria-expanded={showPayments}
          >
            <Receipt className="w-4 h-4" />
            {t("paymentLog")}
          </button>
        </div>
      </div>

      {/* ── Overdue banner ────────────────────────────────────────────────── */}
      {overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded p-3 text-sm border bg-red-50 border-red-200 text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {t("overdueBanner", { count: overdueCount })}
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded p-3 text-sm border bg-red-50 border-red-200 text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={loadRemesas} className="text-xs underline hover:no-underline">
            {t("retry")}
          </button>
        </div>
      )}

      {/* ── PD7A generation card ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg border">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            {t("pd7aSection")}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">{t("pd7aDescription")}</p>
        </div>
        <button
          onClick={handleGeneratePd7a}
          disabled={generatingPd7a}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-navy text-white text-sm font-medium rounded hover:bg-brand-navy/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generatingPd7a ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("generatingPd7a")}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              {t("generatePd7aButton")}
            </>
          )}
        </button>
        {pd7aError && <div className="w-full text-sm text-red-600">{pd7aError}</div>}
      </div>

      {/* ── PD7A preview ────────────────────────────────────────────────────── */}
      {showPd7aPreview && pd7aPreview && (
        <div className="border rounded-lg overflow-hidden bg-white">
          <div className="flex items-center justify-between px-4 py-3 bg-green-50 border-b">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-green-800">
              <CheckCircle2 className="w-4 h-4" />
              {t("pd7aGenerated")}
            </h3>
            <button
              onClick={() => setShowPd7aPreview(false)}
              className="p-1 rounded hover:bg-green-100"
              aria-label={t("close")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-xs text-gray-500">{t("pd7aTable.period")}</span>
              <div className="font-medium">
                {pd7aPreview.periodoInicio} → {pd7aPreview.periodoFin}
              </div>
            </div>
            <div>
              <span className="text-xs text-gray-500">{t("pd7aTable.quincena")}</span>
              <div className="font-medium">{pd7aPreview.quincena}</div>
            </div>
            <div>
              <span className="text-xs text-gray-500">{t("pd7aTable.businessNumber")}</span>
              <div className="font-mono text-xs">{pd7aPreview.businessNumber}</div>
            </div>
            <div>
              <span className="text-xs text-gray-500">{t("pd7aTable.dueDate")}</span>
              <div className="font-medium text-amber-700">{pd7aPreview.fechaVencimiento}</div>
            </div>
            <div>
              <span className="text-xs text-gray-500">{t("pd7aTable.employees")}</span>
              <div className="font-medium">{pd7aPreview.employeeCount}</div>
            </div>
            <div>
              <span className="text-xs text-gray-500">{t("pd7aTable.grossPayroll")}</span>
              <div className="font-medium tabular-nums">{formatCad(pd7aPreview.grossPayrollCents, locale)}</div>
            </div>
          </div>

          {/* Breakdown table */}
          <div className="border-t px-4 py-3">
            <h4 className="text-xs font-medium text-gray-500 mb-2">{t("pd7aTable.breakdown")}</h4>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">{t("pd7aTable.cppEmployee")}</span>
                <span className="tabular-nums">{formatCad(pd7aPreview.cppEmployeeCents, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">{t("pd7aTable.cppEmployer")}</span>
                <span className="tabular-nums">{formatCad(pd7aPreview.cppEmployerCents, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">{t("pd7aTable.eiEmployee")}</span>
                <span className="tabular-nums">{formatCad(pd7aPreview.eiEmployeeCents, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">{t("pd7aTable.eiEmployer")}</span>
                <span className="tabular-nums">{formatCad(pd7aPreview.eiEmployerCents, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">{t("pd7aTable.incomeTax")}</span>
                <span className="tabular-nums">{formatCad(pd7aPreview.taxTotalCents, locale)}</span>
              </div>
              <div className="flex justify-between font-semibold pt-1.5 border-t">
                <span>{t("pd7aTable.totalRemittance")}</span>
                <span className="tabular-nums text-brand-navy">
                  {formatCad(pd7aPreview.totalRemittanceCents, locale)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center gap-2 p-8 text-sm text-gray-500 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("loading")}
        </div>
      ) : remesas.length === 0 ? (
        /* ── Empty ─────────────────────────────────────────────────────── */
        <div className="p-8 text-center text-sm text-gray-500 border rounded-lg">
          {t("empty")}
        </div>
      ) : (
        /* ── Remittances table ──────────────────────────────────────────── */
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.tipo")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.periodo")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    {t("table.monto")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.vencimiento")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.estado")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {t("table.comprobante")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    <span className="sr-only">{t("table.acciones")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((remesa) => {
                  const badge = ESTADO_BADGE[
                    remesa.estado === "vencido" || (remesa.estado === "pendiente" && isOverdue(remesa.fecha_vencimiento))
                      ? "vencido"
                      : remesa.estado
                  ];
                  const remainingDays = remesa.estado !== "pagado" ? daysUntilDue(remesa.fecha_vencimiento) : null;
                  const overdueFlag =
                    remesa.estado !== "pagado" && isOverdue(remesa.fecha_vencimiento);

                  return (
                    <tr
                      key={remesa.remesa_id}
                      className={`border-t border-gray-100 hover:bg-gray-50 ${
                        overdueFlag ? "bg-red-50/50" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        {TIPO_LABELS[remesa.tipo]}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{remesa.periodo}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {formatCad(remesa.monto_total, locale)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={overdueFlag ? "text-red-700 font-medium" : ""}>
                          {new Date(`${remesa.fecha_vencimiento}T00:00:00.000`).toLocaleDateString(
                            locale === "fr" ? "fr-CA" : locale === "zh" ? "zh-CN" : "en-CA",
                          )}
                        </span>
                        {remainingDays !== null && remainingDays > 0 && (
                          <span className="text-xs text-gray-400 ml-1">
                            ({t("daysRemaining", { count: remainingDays })})
                          </span>
                        )}
                        {remainingDays !== null && remainingDays < 0 && (
                          <span className="text-xs text-red-600 ml-1">
                            ({t("daysOverdue", { count: Math.abs(remainingDays) })})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${badge.color}`}
                        >
                          {badge.icon}
                          {t(badge.labelKey)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {remesa.comprobante_cra ? (
                          <span className="text-xs font-mono text-gray-500">{remesa.comprobante_cra}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                        {remesa.fecha_pago && (
                          <span className="block text-xs text-gray-400 mt-0.5">
                            {new Date(`${remesa.fecha_pago}T00:00:00.000`).toLocaleDateString(
                              locale === "fr" ? "fr-CA" : locale === "zh" ? "zh-CN" : "en-CA",
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {/* Download */}
                          <button
                            onClick={() => handleDownload(remesa.remesa_id)}
                            disabled={downloadingId === remesa.remesa_id}
                            className="p-1 rounded hover:bg-gray-100 disabled:opacity-50"
                            aria-label={t("downloadRemittance")}
                            title={t("downloadRemittance")}
                          >
                            {downloadingId === remesa.remesa_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Mark as paid */}
                          {remesa.estado !== "pagado" && (
                            <button
                              onClick={() => {
                                setMarkPaidId(remesa.remesa_id);
                                setMarkPaidError("");
                              }}
                              className="text-xs text-brand-navy hover:underline"
                            >
                              {t("markPaid")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Payment log ────────────────────────────────────────────────────── */}
      {showPayments && (
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Receipt className="w-4 h-4" />
              {t("paymentLogTitle")}
            </h3>
            <button
              onClick={loadPayments}
              className="p-1.5 rounded hover:bg-gray-200"
              aria-label={t("refresh")}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {payments.length === 0 ? (
            <div className="p-6 text-sm text-gray-500 text-center">{t("noPayments")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {t("paymentTable.date")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {t("paymentTable.tipo")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {t("paymentTable.periodo")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                      {t("paymentTable.monto")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {t("paymentTable.comprobante")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(p.fecha_pago).toLocaleDateString(
                          locale === "fr" ? "fr-CA" : locale === "zh" ? "zh-CN" : "en-CA",
                        )}
                      </td>
                      <td className="px-3 py-2">{TIPO_LABELS[p.tipo]}</td>
                      <td className="px-3 py-2 text-gray-600">{p.periodo}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCad(p.monto_cents, locale)}
                      </td>
                      <td className="px-3 py-2">
                        {p.comprobante ? (
                          <span className="text-xs font-mono text-gray-600">{p.comprobante}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
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

      {/* ── Mark as paid modal ──────────────────────────────────────────────── */}
      {markPaidId && (
        <ConfirmActionModal
          title={t("markPaidModal.title")}
          confirmLabel={markingPaid ? t("markPaidModal.processing") : t("markPaidModal.confirm")}
          isConfirming={markingPaid}
          fields={[
            {
              key: "fecha_pago",
              label: t("markPaidModal.dateLabel"),
              type: "text",
              required: true,
              autoFocus: true,
            },
            {
              key: "comprobante",
              label: t("markPaidModal.referenceLabel"),
              required: false,
              helperText: t("markPaidModal.referenceHint"),
            },
            {
              key: "amount",
              label: t("markPaidModal.amountLabel"),
              type: "number",
              required: false,
              helperText: t("markPaidModal.amountHint"),
            },
          ]}
          onCancel={() => {
            setMarkPaidId(null);
            setMarkPaidError("");
          }}
          onConfirm={handleMarkPaid}
        >
          {markPaidError && (
            <div className="mt-2 flex items-center gap-2 rounded p-2 text-sm border bg-red-50 border-red-200 text-red-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {markPaidError}
            </div>
          )}
        </ConfirmActionModal>
      )}
    </div>
  );
}
