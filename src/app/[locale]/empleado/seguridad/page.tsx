"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { ShieldAlert, HeartPulse, Loader2, CheckCircle2, Siren, CloudUpload } from "lucide-react";
import { EmpleadoBackHeader } from "@/components/empleado/EmpleadoBackHeader";
import { submitGenericReportOrQueue } from "@/lib/offline-sync-client";

/**
 * v8.3 E7 (D.10 #7) — Panel de seguridad del empleado. La activación de
 * SOS ya vive en el botón flotante global (SafetyAbortButton, montado en
 * empleado/layout.tsx por otra sesión concurrente) -- por eso esta página
 * NO la duplica, solo la referencia. Lo que sí faltaba, y esta página
 * agrega, es el formulario de near-miss y el de incidente laboral: sus
 * rutas (/api/empleado/near-miss, /api/empleado/workplace-incident) y
 * sus páginas admin de revisión ya existían, pero ningún componente las
 * invocaba -- eran inalcanzables desde el campo.
 */
export default function SeguridadPage() {
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const backHref = `/${locale}/empleado`;
  return (
    <main className="min-h-screen bg-brand-ice">
      <EmpleadoBackHeader title="Safety" backHref={backHref} />
      <div className="p-4 max-w-lg mx-auto space-y-6">
        <h1 className="text-xl font-bold text-brand-ink">Safety</h1>
        <div className="bg-state-danger/5 border border-state-danger/20 rounded-xl p-4 flex items-center gap-3">
          <Siren className="w-6 h-6 text-state-danger flex-shrink-0" />
          <p className="text-sm text-gray-600">
            For an emergency, use the red <strong>SOS</strong> button in the bottom-right corner —
            it&apos;s available on every page.
          </p>
        </div>
        <NearMissSection />
        <WorkplaceIncidentSection />
      </div>
    </main>
  );
}

const NEAR_MISS_CATEGORIES = [
  { value: "near_fall", label: "Near fall" },
  { value: "near_chemical_mix", label: "Near chemical mix" },
  { value: "near_bite", label: "Near bite" },
  { value: "near_burn", label: "Near burn" },
  { value: "other", label: "Other" },
];

function NearMissSection() {
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
      setError("Please select a category.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await submitGenericReportOrQueue("/api/empleado/near-miss", {
        category,
        description: description.trim() || undefined,
        isAnonymous,
      });
      if (!result.ok) {
        setError(result.error || "Failed to report");
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
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-elevation-1 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-state-warning" />
        <h2 className="font-semibold text-brand-ink">Report a Near-Miss</h2>
      </div>
      <p className="text-xs text-gray-500">
        A close call, no injury — reporting this never affects your score. You can report
        anonymously.
      </p>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {success && (
        <div className="flex items-center gap-2 text-state-success text-sm">
          <CheckCircle2 className="w-4 h-4" /> Reported. Thank you.
        </div>
      )}
      {queued && (
        <div className="flex items-center gap-2 text-brand-navy text-sm">
          <CloudUpload className="w-4 h-4" /> No connection — saved on this device, will send automatically.
        </div>
      )}
      <select
        aria-label="Categoría del cuasi-accidente"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full border rounded px-2 py-1.5 text-sm"
      >
        <option value="">Select category…</option>
        {NEAR_MISS_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <textarea
        aria-label="Descripción del cuasi-accidente"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What happened? (optional)"
        className="w-full border rounded px-2 py-1.5 text-sm"
        rows={2}
      />
      <label htmlFor="near-miss-anonymous" className="flex items-center gap-2 text-xs text-gray-500">
        <input id="near-miss-anonymous" type="checkbox" aria-label="Report anonymously" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
        Report anonymously
      </label>
      <button
        aria-label="Enviar reporte de cuasi-accidente"
        onClick={submit}
        disabled={submitting}
        className="w-full bg-brand-navy text-white rounded py-2 text-sm flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Submit
      </button>
    </div>
  );
}

const MEDICAL_ATTENTION_OPTIONS = [
  { value: "none", label: "None needed" },
  { value: "first_aid", label: "First aid" },
  { value: "clinic", label: "Clinic visit" },
  { value: "hospital", label: "Hospital" },
];

function WorkplaceIncidentSection() {
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
      setError("Please describe the injury.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await submitGenericReportOrQueue("/api/empleado/workplace-incident", {
        incidentDatetime: new Date().toISOString(),
        injuryDescription: injuryDescription.trim(),
        bodyPartAffected: bodyPartAffected.trim() || undefined,
        medicalAttentionType,
        locationDescription: locationDescription.trim() || undefined,
        immediateActionTaken: immediateActionTaken.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error || "Failed to report");
        return;
      }
      if (result.queued) {
        setQueued(true);
      } else {
        const data = result.data as { workplaceIncident: { worksafebc_report_due_at: string } };
        setSuccess(
          "Reported. WorkSafeBC deadline: " +
            new Date(data.workplaceIncident.worksafebc_report_due_at).toLocaleString()
        );
      }
      setInjuryDescription("");
      setBodyPartAffected("");
      setLocationDescription("");
      setImmediateActionTaken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-elevation-1 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <HeartPulse className="w-5 h-5 text-state-danger" />
        <h2 className="font-semibold text-brand-ink">Report a Workplace Injury</h2>
      </div>
      <p className="text-xs text-gray-500">Any actual injury, however minor. This starts the WorkSafeBC 72h clock.</p>
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
          <CloudUpload className="w-4 h-4 flex-shrink-0" /> No connection — saved on this device, will send
          automatically as soon as you have signal. The WorkSafeBC 72h clock is already running from the time
          of the incident, not from when this syncs — tell your supervisor now if this is serious.
        </div>
      )}
      <textarea
        aria-label="Descripción de la lesión"
        value={injuryDescription}
        onChange={(e) => setInjuryDescription(e.target.value)}
        placeholder="Describe what happened *"
        className="w-full border rounded px-2 py-1.5 text-sm"
        rows={2}
      />
      <input
        aria-label="Parte del cuerpo afectada"
        value={bodyPartAffected}
        onChange={(e) => setBodyPartAffected(e.target.value)}
        placeholder="Body part affected"
        className="w-full border rounded px-2 py-1.5 text-sm"
      />
      <select
        aria-label="Tipo de atención médica recibida"
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
      <input
        aria-label="Ubicación del incidente"
        value={locationDescription}
        onChange={(e) => setLocationDescription(e.target.value)}
        placeholder="Location"
        className="w-full border rounded px-2 py-1.5 text-sm"
      />
      <textarea
        aria-label="Acción inmediata tomada"
        value={immediateActionTaken}
        onChange={(e) => setImmediateActionTaken(e.target.value)}
        placeholder="Immediate action taken (optional)"
        className="w-full border rounded px-2 py-1.5 text-sm"
        rows={2}
      />
      <button
        onClick={submit}
        disabled={submitting}
        className="w-full bg-state-danger text-white rounded py-2 text-sm flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Report Injury
      </button>
    </div>
  );
}
