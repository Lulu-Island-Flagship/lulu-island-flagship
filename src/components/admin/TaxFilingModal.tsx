"use client";

/**
 * TaxFilingModal — modal para revisar y aprobar envíos fiscales ante la CRA.
 *
 * Flujo:
 *  1. Generación del XML de GST return (tax-netfile.ts)
 *  2. Vista previa del XML con syntax highlighting
 *  3. Checklist de revisión obligatoria
 *  4. Doble confirmación para enviar (ConfirmActionModal)
 *  5. Registro del intento (recordFilingAttempt)
 *
 * NOTA: La transmisión real a CRA se realiza fuera del sistema
 * (portal NETFILE de CRA o software certificado). Este modal produce
 * y valida el XML que se carga en dicho portal.
 *
 * React 18, next-intl, useFocusTrap.
 */

import React, { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  X,
  CheckCircle2,
  Circle,
  AlertTriangle,
  FileCode,
  Eye,
  Send,
  ChevronRight,
  Download,
} from "lucide-react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  validateGstReturnXml,
} from "@/lib/tax-netfile";
import type { TaxObligationSummary } from "@/components/admin/TaxDashboard";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

// ── Types ──────────────────────────────────────────────────────────────────

type Step = "generate" | "review" | "confirm";

interface ChecklistItem {
  key: string;
  label: string;
  checked: boolean;
}

// ── Mock helpers ───────────────────────────────────────────────────────────

function generateMockXml(period: string): string {
  const bn = "123456789RT0001";
  const today = new Date().toISOString().slice(0, 10);
  const txId = `TX-${period.replace(/\s/g, "")}-${Date.now()}`;
  const [year, qLabel] = period.split(" ");
  const qNum = qLabel?.replace("Q", "") ?? "2";
  const startMonth = (parseInt(qNum) - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const start = `${year}-${String(startMonth).padStart(2, "0")}`;
  const end = `${year}-${String(endMonth).padStart(2, "0")}`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<GSTHSTReturn`,
    `  xmlns="http://www.cra-arc.gc.ca/gncy/bn"`,
    `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
    `  returnType="Original"`,
    `  referencePeriod="${year}-Q${qNum}"`,
    `  generatedDate="${today}"`,
    `>`,
    ``,
    `  <!-- Transmission Header — T619 Electronic Filing -->`,
    `  <TransmissionHeader>`,
    `    <TransmissionID>${txId}</TransmissionID>`,
    `    <TransmissionDate>${today}</TransmissionDate>`,
    `    <TransmitterSoftwareCode>LULUISLAND-FLAGSHIP-V1</TransmitterSoftwareCode>`,
    `    <TransmitterSoftwareVersion>1.0.0</TransmitterSoftwareVersion>`,
    `  </TransmissionHeader>`,
    ``,
    `  <!-- GST/HST Registrant Information -->`,
    `  <RegistrantInformation>`,
    `    <BusinessNumber>${bn}</BusinessNumber>`,
    `    <FiscalPeriodStart>${start}-01</FiscalPeriodStart>`,
    `    <FiscalPeriodEnd>${end}-${String(new Date(parseInt(year), endMonth, 0).getDate()).padStart(2, "0")}</FiscalPeriodEnd>`,
    `    <FilingFrequency>Quarterly</FilingFrequency>`,
    `  </RegistrantInformation>`,
    ``,
    `  <!-- GST/HST Return — Line Items -->`,
    `  <ReturnLines>`,
    `    <Line101>125000.00</Line101>`,
    `    <Line103>6250.00</Line103>`,
    `    <Line104>0.00</Line104>`,
    `    <Line105>6250.00</Line105>`,
    `    <Line106>1850.00</Line106>`,
    `    <Line107>0.00</Line107>`,
    `    <Line108>1850.00</Line108>`,
    `    <Line109>4400.00</Line109>`,
    `    <Line110>0.00</Line110>`,
    `    <Line111>0.00</Line111>`,
    `    <Line112>4400.00</Line112>`,
    `    <Line113A>0.00</Line113A>`,
    `    <Line115>4400.00</Line115>`,
    `  </ReturnLines>`,
    ``,
    `  <!-- Supplementary Information — BC Provincial Sales Tax (PST) -->`,
    `  <SupplementaryInformation>`,
    `    <Province>BC</Province>`,
    `    <PSTCollected>8750.00</PSTCollected>`,
    `    <PSTRateApplied>7%</PSTRateApplied>`,
    `    <Note>PST se remite separadamente ante BC Ministry of Finance (eTaxBC).</Note>`,
    `  </SupplementaryInformation>`,
    ``,
    `  <!-- Declaration -->`,
    `  <Declaration>`,
    `    <CertificationStatement>`,
    `      I certify that the information given in this return is correct and complete,`,
    `      and that I am authorized by the registrant to file this return.`,
    `    </CertificationStatement>`,
    `    <GeneratedBySystem>LULUISLAND-FLAGSHIP-V1</GeneratedBySystem>`,
    `    <GeneratedDate>${today}</GeneratedDate>`,
    `  </Declaration>`,
    ``,
    `</GSTHSTReturn>`,
  ].join("\n");
}

// ── Syntax highlighting for XML ───────────────────────────────────────────

function highlightXml(xml: string): React.ReactNode[] {
  const lines = xml.split("\n");
  return lines.map((line, i) => {
    // Comment
    if (line.trim().startsWith("<!--")) {
      return (
        <span key={i} className="block text-green-600">
          {line}
        </span>
      );
    }
    // Tag + content
    const highlighted = line.replace(
      /(<\/?)([\w:]+)([\s>])|([\w-]+)="([^"]*)"/g,
      (match, openBracket, tagName, afterTag, attrName, attrValue) => {
        if (openBracket !== undefined) {
          // Opening/closing bracket + tag name
          return (
            '<span class="text-blue-700">' +
            openBracket +
            '</span><span class="text-purple-700">' +
            tagName +
            "</span>" +
            afterTag
          );
        }
        if (attrName !== undefined) {
          // Attribute
          return (
            '<span class="text-amber-700">' +
            attrName +
            '</span>=<span class="text-orange-600">"' +
            attrValue +
            '"</span>'
          );
        }
        return match;
      },
    );
    return (
      <span
        key={i}
        className="block"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    );
  });
}

// ── Component ──────────────────────────────────────────────────────────────

interface TaxFilingModalProps {
  obligation: TaxObligationSummary;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function TaxFilingModal({
  obligation,
  onClose,
  onSubmitted,
}: TaxFilingModalProps) {
  const t = useTranslations("admin.tax");
  const modalRef = useRef<HTMLDivElement>(null);

  // State
  const [step, setStep] = useState<Step>("generate");
  const [xml, setXml] = useState("");
  const [generating, setGenerating] = useState(true);
  const [validation, setValidation] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [showXml, setShowXml] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([
    { key: "amounts", label: t("modal.checklist.amounts"), checked: false },
    { key: "itcs", label: t("modal.checklist.itcs"), checked: false },
    { key: "period", label: t("modal.checklist.period"), checked: false },
    { key: "bn", label: t("modal.checklist.bn"), checked: false },
    { key: "pst", label: t("modal.checklist.pst"), checked: false },
  ]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [generateError, setGenerateError] = useState("");

  // Focus trap
  useFocusTrap(modalRef, true);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Generate XML
  useEffect(() => {
    let cancelled = false;
    setGenerating(true);
    setGenerateError("");

    // Simulate async generation
    setTimeout(() => {
      if (cancelled) return;
      try {
        const generated = generateMockXml(obligation.period);
        setXml(generated);
        const result = validateGstReturnXml(generated);
        setValidation(result);
        setStep("review");
      } catch (err) {
        setGenerateError(
          err instanceof Error ? err.message : t("modal.errors.generateFailed"),
        );
      } finally {
        if (!cancelled) setGenerating(false);
      }
    }, 1200);

    return () => {
      cancelled = true;
    };
  }, [obligation.period, t]);

  // Check if all checklist items are checked
  const allChecked = checklist.every((item) => item.checked);

  // Handle submit
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // In production: POST to /api/admin/tax/netfile
      // await fetch(...)
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setSubmitted(true);
      setTimeout(() => onSubmitted(), 2000);
    } catch {
      // error stays in modal
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" aria-modal="true" role="dialog">
        <div
          ref={modalRef}
          className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col mx-4 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-brand-navy">
                {t("modal.title", { label: obligation.label })}
              </h2>
              <p className="text-sm text-gray-500">
                {t("modal.subtitle", { deadline: obligation.deadline })}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-md transition-colors"
              aria-label={t("modal.close")}
              disabled={submitting}
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* ── Step: Generating ─────────────────────────────────────── */}
            {step === "generate" && (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                {generating ? (
                  <>
                    <Loader2 className="w-10 h-10 text-brand-navy animate-spin" aria-label={t("modal.generating")} />
                    <p className="text-gray-600 font-medium">{t("modal.generating")}</p>
                    <p className="text-sm text-gray-400">{t("modal.generatingHint")}</p>
                  </>
                ) : generateError ? (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <AlertTriangle className="w-10 h-10 text-red-500" aria-hidden="true" />
                    <p className="text-red-600 font-medium">{generateError}</p>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 text-sm bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      {t("modal.close")}
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            {/* ── Step: Review ────────────────────────────────────────── */}
            {step === "review" && (
              <>
                {/* Validation results */}
                {validation && (
                  <div className="space-y-2">
                    {validation.valid ? (
                      <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-4 py-3">
                        <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                        <span className="font-medium text-sm">{t("modal.validation.passed")}</span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 text-red-700 bg-red-50 rounded-lg px-4 py-3">
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                        <div>
                          <p className="font-medium text-sm">{t("modal.validation.failed")}</p>
                          <ul className="list-disc list-inside text-sm mt-1">
                            {validation.errors.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    {validation.warnings.length > 0 && (
                      <div className="flex items-start gap-2 text-amber-700 bg-amber-50 rounded-lg px-4 py-3">
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                        <div>
                          <p className="font-medium text-sm">{t("modal.validation.warnings")}</p>
                          <ul className="list-disc list-inside text-sm mt-1">
                            {validation.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* XML Preview */}
                <div>
                  <button
                    onClick={() => setShowXml(!showXml)}
                    className="inline-flex items-center gap-2 text-sm text-brand-navy hover:text-brand-navy/70 font-medium transition-colors"
                  >
                    {showXml ? (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <FileCode className="w-4 h-4" aria-hidden="true" />
                    )}
                    {showXml ? t("modal.hideXml") : t("modal.showXml")}
                  </button>
                  {showXml && (
                    <div className="mt-3 rounded-lg border bg-gray-900 p-4 overflow-x-auto max-h-64">
                      <pre className="text-xs text-gray-100 font-mono leading-relaxed whitespace-pre">
                        {highlightXml(xml)}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Review Checklist */}
                <div className="rounded-lg border bg-white p-4">
                  <h3 className="font-medium text-brand-navy mb-3">{t("modal.checklist.title")}</h3>
                  <div className="space-y-2.5">
                    {checklist.map((item) => (
                      <label
                        key={item.key}
                        className="flex items-start gap-3 cursor-pointer select-none group"
                      >
                        <button
                          role="checkbox"
                          aria-checked={item.checked}
                          onClick={() =>
                            setChecklist((prev) =>
                              prev.map((i) =>
                                i.key === item.key ? { ...i, checked: !i.checked } : i,
                              ),
                            )
                          }
                          className="shrink-0 mt-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy rounded"
                        >
                          {item.checked ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600" aria-hidden="true" />
                          ) : (
                            <Circle className="w-5 h-5 text-gray-300 group-hover:text-gray-400 transition-colors" aria-hidden="true" />
                          )}
                        </button>
                        <span className="text-sm text-gray-700">{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Progress Stepper */}
                <div className="flex items-center gap-2 text-xs text-gray-400 pt-2">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
                    {t("modal.stepper.generated")}
                  </span>
                  <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  <span className="flex items-center gap-1">
                    {validation?.valid ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                    )}
                    {t("modal.stepper.validated")}
                  </span>
                  <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  <span className="flex items-center gap-1 text-gray-300">
                    <Circle className="w-3.5 h-3.5" aria-hidden="true" />
                    {t("modal.stepper.ready")}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          {step === "review" && (
            <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50 shrink-0">
              <div className="flex items-center gap-3">
                <a
                  href={`data:text/xml;charset=utf-8,${encodeURIComponent(xml)}`}
                  download={`GST-${obligation.period.replace(/\s/g, "-")}-NETFILE.xml`}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                  {t("modal.downloadXml")}
                </a>
              </div>
              <button
                onClick={() => setShowConfirm(true)}
                disabled={!allChecked || submitting}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white font-medium text-sm transition-all ${
                  allChecked && !submitting
                    ? "bg-brand-navy hover:bg-brand-navy/90 cursor-pointer"
                    : "bg-gray-300 cursor-not-allowed"
                }`}
              >
                <Send className="w-4 h-4" aria-hidden="true" />
                {t("modal.submit")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Double Confirmation Modal ─────────────────────────────────── */}
      {showConfirm && (
        <ConfirmActionModal
          title={t("modal.confirm.title")}
          message={
            <div className="space-y-2">
              <p>{t("modal.confirm.message", { label: obligation.label })}</p>
              <p className="text-sm text-gray-500">{t("modal.confirm.disclaimer")}</p>
            </div>
          }
          noticeText={t("modal.confirm.notice")}
          confirmLabel={t("modal.confirm.confirmLabel")}
          danger={false}
          onConfirm={async () => {
            await handleSubmit();
          }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {/* ── Success Toast ─────────────────────────────────────────────── */}
      {submitted && (
        <div className="fixed bottom-6 right-6 z-[60] bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-right">
          <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
          <span className="font-medium">{t("modal.successMessage")}</span>
        </div>
      )}
    </>
  );
}
