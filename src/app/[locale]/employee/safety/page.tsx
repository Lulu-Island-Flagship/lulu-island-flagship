"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldAlert, HeartPulse, Loader2, CheckCircle2, Siren, CloudUpload } from "lucide-react";
import { EmpleadoBackHeader } from "@/components/empleado/EmpleadoBackHeader";
import { submitGenericReportOrQueue } from "@/lib/offline-sync-client";

/**
 * v8.3 E7 (D.10 #7) — Panel de seguridad del empleado. La activación de
 * SOS ya vive en el botón flotante global (SafetyAbortButton, montado en
 * empleado/layout.tsx por otra sesión concurrente) -- por eso esta página
 * NO la duplica, solo la referencia. Lo que sí faltaba, y esta página
 * agrega, es el formulario de near-miss y el de incidente laboral: sus
 * rutas (/api/employee/near-miss, /api/employee/workplace-incident) y
 * sus páginas admin de revisión ya existían, pero ningún componente las
 * invocaba -- eran inalcanzables desde el campo.
 *
 * Fix (auditoría externa 2026-08-02, hallazgo MEDIO #5): toda esta página
 * estaba hardcodeada en inglés fijo sin importar el locale de la ruta
 * (/fr/empleado/seguridad, /zh/empleado/seguridad). Se usa next-intl
 * (claves bajo "employee.safetyPage" en messages/{en,fr,zh}.json) --
 * NextIntlClientProvider ya está montado en empleado/layout.tsx.
 */
export default function SeguridadPage() {
  const t = useTranslations("employee.safetyPage");
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const backHref = `/${locale}/employee`;
  return (
    <main className="min-h-screen bg-brand-ice">
      <EmpleadoBackHeader title={t("title")} backHref={backHref} />
      <div className="p-4 max-w-lg mx-auto space-y-6">
        <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
        <div className="bg-state-danger/5 border border-state-danger/20 rounded-xl p-4 flex items-center gap-3">
          <Siren className="w-6 h-6 text-state-danger flex-shrink-0" />
          <p className="text-sm text-gray-600">
            {t.rich("sosNotice", { strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
        </div>
        <NearMissSection />
        <WorkplaceIncidentSection />
      </div>
    </main>
  );
}

function NearMissSection() {
  const t = useTranslations("employee.safetyPage.nearMiss");
  const NEAR_MISS_CATEGORIES = [
    { value: "near_fall", label: t("categories.nearFall") },
    { value: "near_chemical_mix", label: t("categories.nearChemicalMix") },
    { value: "near_bite", label: t("categories.nearBite") },
    { value: "near_burn", label: t("categories.nearBurn") },
    { value: "other", label: t("categories.other") },
  ];
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  // Fix (auditoría 2026-07-31, #6): sin señal, este reporte se perdía
  // silenciosamente (fetch fallaba y solo se mostraba un error genérico de
  // red, sin persistencia local) -- un cuasi-accidente es justo el tipo de
  // dato que D.10 excepción #1 pide nunca perder offline. Se reutiliza la
  // cola offline existente (submitGenericReportOrQueue).
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!category) {
      setError(t("selectCategoryError"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await submitGenericReportOrQueue("/api/employee/near-miss", {
        category,
        description: description.trim() || undefined,
        isAnonymous,
      });
      if (!result.ok) {
        setError(result.error || t("failedToReport"));
        return;
      }
      if (result.queued) {
        setQueued(true);
      } else {
        setSuccess(true);
      }
      setCategory("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-elevation-1 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-state-warning" />
        <h2 className="font-semibold text-brand-ink">{t("title")}</h2>
      </div>
      <p className="text-xs text-gray-500">{t("description")}</p>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {success && (
        <div className="flex items-center gap-2 text-state-success text-sm">
          <CheckCircle2 className="w-4 h-4" /> {t("reportedThankYou")}
        </div>
      )}
      {queued && (
        <div className="flex items-center gap-2 text-brand-navy text-sm">
          <CloudUpload className="w-4 h-4" /> {t("queuedNotice")}
        </div>
      )}
      <label htmlFor="near-miss-category" className="block text-xs text-gray-500">
        {t("categoryLabel")}
      </label>
      <select
        id="near-miss-category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full border rounded px-2 py-1.5 text-sm"
      >
        <option value="">{t("categorySelectPlaceholder")}</option>
        {NEAR_MISS_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <label htmlFor="near-miss-description" className="block text-xs text-gray-500">
        {t("descriptionLabel")}
      </label>
      <textarea
        id="near-miss-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("descriptionPlaceholder")}
        className="w-full border rounded px-2 py-1.5 text-sm"
        rows={2}
      />
      <label htmlFor="near-miss-anonymous" className="flex items-center gap-2 text-xs text-gray-500">
        <input id="near-miss-anonymous" type="checkbox" aria-label={t("anonymousAria")} checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
        {t("anonymousLabel")}
      </label>
      <button
        aria-label={t("submitAria")}
        onClick={submit}
        disabled={submitting}
        className="w-full bg-brand-navy text-white rounded py-2 text-sm flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {t("submit")}
      </button>
    </div>
  );
}

function WorkplaceIncidentSection() {
  const t = useTranslations("employee.safetyPage.workplaceIncident");
  const MEDICAL_ATTENTION_OPTIONS = [
    { value: "none", label: t("medicalAttentionOptions.none") },
    { value: "first_aid", label: t("medicalAttentionOptions.firstAid") },
    { value: "clinic", label: t("medicalAttentionOptions.clinic") },
    { value: "hospital", label: t("medicalAttentionOptions.hospital") },
  ];
  const [injuryDescription, setInjuryDescription] = useState("");
  const [bodyPartAffected, setBodyPartAffected] = useState("");
  const [medicalAttentionType, setMedicalAttentionType] = useState("none");
  const [locationDescription, setLocationDescription] = useState("");
  const [immediateActionTaken, setImmediateActionTaken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  // Fix (auditoría 2026-07-31, #6): un reporte de lesión real ES el caso más
  // crítico de "no perder datos offline" de toda esta página (arranca el
  // reloj de 72h de WorkSafeBC) -- antes se perdía en silencio sin señal.
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!injuryDescription.trim()) {
      setError(t("describeInjuryError"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await submitGenericReportOrQueue("/api/employee/workplace-incident", {
        incidentDatetime: new Date().toISOString(),
        injuryDescription: injuryDescription.trim(),
        bodyPartAffected: bodyPartAffected.trim() || undefined,
        medicalAttentionType,
        locationDescription: locationDescription.trim() || undefined,
        immediateActionTaken: immediateActionTaken.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error || t("failedToReport"));
        return;
      }
      if (result.queued) {
        setQueued(true);
      } else {
        const data = result.data as { workplaceIncident: { worksafebc_report_due_at: string } };
        setSuccess(
          t("reportedWithDeadline", {
            deadline: new Date(data.workplaceIncident.worksafebc_report_due_at).toLocaleString(),
          })
        );
      }
      setInjuryDescription("");
      setBodyPartAffected("");
      setLocationDescription("");
      setImmediateActionTaken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-elevation-1 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <HeartPulse className="w-5 h-5 text-state-danger" />
        <h2 className="font-semibold text-brand-ink">{t("title")}</h2>
      </div>
      <p className="text-xs text-gray-500">{t("description")}</p>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {success && (
        <div className="flex items-center gap-2 text-state-success text-sm">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {success}
        </div>
      )}
      {queued && (
        <div className="flex items-center gap-2 text-brand-navy text-sm">
          {/* Fix (auditoría implacable, hallazgo nuevo): este texto decía
              "the WorkSafeBC clock starts once it syncs" -- falso. El
              servidor calcula worksafebc_report_due_at a partir de
              incidentDatetime (capturado AHORA, antes de encolar, ver
              submit() más arriba y computeWorkSafeBCDeadline en la API),
              no del momento de sincronización. Decirle a un empleado
              lesionado que el reloj "todavía no arrancó" podía retrasar
              peligrosamente que avise a su supervisor. */}
          <CloudUpload className="w-4 h-4 flex-shrink-0" /> {t("queuedNotice")}
        </div>
      )}
      <label htmlFor="injury-description" className="block text-xs text-gray-500">
        {t("injuryDescriptionLabel")}
      </label>
      <textarea
        id="injury-description"
        value={injuryDescription}
        onChange={(e) => setInjuryDescription(e.target.value)}
        placeholder={t("injuryDescriptionPlaceholder")}
        className="w-full border rounded px-2 py-1.5 text-sm"
        rows={2}
      />
      <label htmlFor="body-part-affected" className="block text-xs text-gray-500">
        {t("bodyPartLabel")}
      </label>
      <input
        id="body-part-affected"
        value={bodyPartAffected}
        onChange={(e) => setBodyPartAffected(e.target.value)}
        placeholder={t("bodyPartPlaceholder")}
        className="w-full border rounded px-2 py-1.5 text-sm"
      />
      <label htmlFor="medical-attention-type" className="block text-xs text-gray-500">
        {t("medicalAttentionLabel")}
      </label>
      <select
        id="medical-attention-type"
        value={medicalAttentionType}
        onChange={(e) => setMedicalAttentionType(e.target.value)}
        className="w-full border rounded px-2 py-1.5 text-sm"
      >
        {MEDICAL_ATTENTION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label htmlFor="incident-location" className="block text-xs text-gray-500">
        {t("locationLabel")}
      </label>
      <input
        id="incident-location"
        value={locationDescription}
        onChange={(e) => setLocationDescription(e.target.value)}
        placeholder={t("locationPlaceholder")}
        className="w-full border rounded px-2 py-1.5 text-sm"
      />
      <label htmlFor="immediate-action-taken" className="block text-xs text-gray-500">
        {t("immediateActionLabel")}
      </label>
      <textarea
        id="immediate-action-taken"
        value={immediateActionTaken}
        onChange={(e) => setImmediateActionTaken(e.target.value)}
        placeholder={t("immediateActionPlaceholder")}
        className="w-full border rounded px-2 py-1.5 text-sm"
        rows={2}
      />
      <button
        onClick={submit}
        disabled={submitting}
        className="w-full bg-state-danger text-white rounded py-2 text-sm flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {t("submit")}
      </button>
    </div>
  );
}
