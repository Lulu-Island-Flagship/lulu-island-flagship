"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { AlertCircle, Loader2, CheckCircle2, Upload, CloudUpload } from "lucide-react";
import { EmpleadoBackHeader } from "@/components/empleado/EmpleadoBackHeader";
import { submitGenericReportOrQueue } from "@/lib/offline-sync-client";
import { getVancouverTodayString } from "@/lib/date-utils";

interface SickLeaveRequest {
  id: string;
  absence_date: string;
  reason_type: "self_reported" | "medical_note";
  reason_text: string;
  pay_type: "paid" | "unpaid_protected" | "discretionary";
  eligibility_reason: string;
  paid_amount_cents: number | null;
}

function formatCad(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

/**
 * v8.3 (BC ESA Parte 5.1) — Reportar un día de enfermedad. El empleado
 * puede escribir una excusa simple ("tengo gripa") O adjuntar una nota
 * médica -- ninguna de las dos es obligatoria sobre la otra.
 *
 * Fix (auditoría externa 2026-08-02, hallazgo MEDIO #5): esta página estaba
 * hardcodeada en inglés fijo sin importar el locale de la ruta. Se usa
 * next-intl (claves bajo "employee.sickLeavePage" en
 * messages/{en,fr,zh}.json) -- NextIntlClientProvider ya está montado en
 * empleado/layout.tsx.
 */
export default function EnfermedadPage() {
  const t = useTranslations("employee.sickLeavePage");
  const PAY_TYPE_LABEL: Record<string, string> = {
    paid: t("payType.paid"),
    unpaid_protected: t("payType.unpaidProtected"),
    discretionary: t("payType.discretionary"),
  };
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const backHref = `/${locale}/employee`;
  const [requests, setRequests] = useState<SickLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Fix (auditoría 2026-07-31, #6): si se pierde la señal justo al enviar
  // el reporte (después de subir la nota médica, si aplica), antes se
  // perdía sin más que un error de red genérico. Se reutiliza la cola
  // offline (submitGenericReportOrQueue) para el POST final -- la subida
  // del archivo en sí sigue exigiendo red (no se puede validar
  // ownership/tipo/tamaño de un archivo que no se ha subido, ver fix #14
  // en la API), así que solo esa parte todavía requiere conexión activa.
  const [queued, setQueued] = useState(false);

  const [absenceDate, setAbsenceDate] = useState(getVancouverTodayString());
  const [reasonType, setReasonType] = useState<"self_reported" | "medical_note">("self_reported");
  const [reasonText, setReasonText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/employee/sick-leave", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("loadFailedError"));
      setRequests(data.requests || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!reasonText.trim()) {
      setError(t("reasonRequiredError"));
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    setQueued(false);
    try {
      let documentPath: string | undefined;

      if (reasonType === "medical_note" && file) {
        setUploadingFile(true);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error(t("notAuthenticatedError"));
        const { data: employee } = await supabase
          .from("employees")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!employee) throw new Error(t("noEmployeeRecordError"));

        const ext = file.name.split(".").pop() || "pdf";
        const path = `${employee.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("sick-notes").upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
        if (uploadError) throw uploadError;
        documentPath = path;
        setUploadingFile(false);
      }

      const result = await submitGenericReportOrQueue("/api/employee/sick-leave", {
        absenceDate,
        reasonType,
        reasonText: reasonText.trim(),
        documentPath,
      });
      if (!result.ok) throw new Error(result.error || t("failedError"));

      if (result.queued) {
        setQueued(true);
      } else {
        const data = result.data as { request: { pay_type: string } };
        setSuccess(t("reportedWithPayType", { payType: PAY_TYPE_LABEL[data.request.pay_type] }));
      }
      setReasonText("");
      setFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setSubmitting(false);
      setUploadingFile(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <EmpleadoBackHeader title={t("title")} backHref={backHref} />
      <div className="p-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-6 h-6 text-state-warning" />
        <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
      </div>
      <p className="text-sm text-gray-500">{t("description")}</p>

      {error && <div className="text-red-600 text-sm">{error}</div>}
      {success && (
        <div className="flex items-center gap-2 text-state-success text-sm">
          <CheckCircle2 className="w-4 h-4" /> {success}
        </div>
      )}
      {queued && (
        <div className="flex items-center gap-2 text-brand-navy text-sm">
          <CloudUpload className="w-4 h-4 flex-shrink-0" /> {t("queuedNotice")}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3">
        <div>
          <label htmlFor="sick-absence-date" className="text-xs text-gray-500">{t("dateLabel")}</label>
          <input
            id="sick-absence-date"
            type="date"
            value={absenceDate}
            onChange={(e) => setAbsenceDate(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-sm mt-1"
          />
        </div>

        <div className="flex gap-4 text-sm">
          <label htmlFor="sick-reason-self" className="flex items-center gap-1.5">
            <input
              id="sick-reason-self"
              type="radio"
              aria-label={t("simpleReason")}
              checked={reasonType === "self_reported"}
              onChange={() => setReasonType("self_reported")}
            />
            {t("simpleReason")}
          </label>
          <label htmlFor="sick-reason-note" className="flex items-center gap-1.5">
            <input
              id="sick-reason-note"
              type="radio"
              aria-label={t("medicalNote")}
              checked={reasonType === "medical_note"}
              onChange={() => setReasonType("medical_note")}
            />
            {t("medicalNote")}
          </label>
        </div>

        <div>
          <label htmlFor="sick-reason-text" className="text-xs text-gray-500">{t("reasonLabel")}</label>
          <textarea
            id="sick-reason-text"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            className="w-full border rounded px-2 py-1.5 text-sm mt-1"
            rows={2}
          />
        </div>

        {reasonType === "medical_note" && (
          <div>
            <label htmlFor="sick-note-file" className="text-xs text-gray-500 flex items-center gap-1">
              <Upload className="w-3 h-3" /> {t("attachNote")}
            </label>
            <input
              id="sick-note-file"
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm mt-1"
            />
          </div>
        )}

        <button
          aria-label={uploadingFile ? t("uploadingAria") : t("submitAria")}
          onClick={submit}
          disabled={submitting}
          className="w-full bg-brand-navy text-white rounded py-2 text-sm flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {uploadingFile ? t("uploading") : t("submit")}
        </button>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-brand-ink mb-2">{t("thisYear")}</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="bg-white rounded-lg shadow-elevation-1 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.absence_date}</span>
                  <span className="text-xs text-gray-500">{PAY_TYPE_LABEL[r.pay_type]}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{r.reason_text}</div>
                {r.paid_amount_cents !== null && (
                  <div className="text-xs text-brand-navy mt-0.5">{formatCad(r.paid_amount_cents)}</div>
                )}
              </div>
            ))}
            {requests.length === 0 && <div className="text-xs text-gray-400">{t("noSickDays")}</div>}
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
