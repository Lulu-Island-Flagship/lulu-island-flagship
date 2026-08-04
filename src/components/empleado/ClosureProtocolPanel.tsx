"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { Check, Loader2, ShieldCheck, Banknote, Camera } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner } from "@/components/empleado/ErrorBanner";

type ExternalConfirmationType = "client_verbal" | "leader_audit" | "auditor_present";
type AltPaymentMethod = "e_transfer" | "cheque" | "cash";

const EXTERNAL_OPTIONS: { value: ExternalConfirmationType; label: string }[] = [
  { value: "client_verbal", label: "Client approved verbally" },
  { value: "leader_audit", label: "Leader visual audit + closing photo" },
  { value: "auditor_present", label: "Auditor present" },
];

const ALT_PAYMENT_OPTIONS: { value: AltPaymentMethod; label: string }[] = [
  { value: "e_transfer", label: "E-transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
];

interface ClosureProtocolPanelProps {
  orderId: string;
  /**
   * v8.3 E6.6: cliente sin smartphone -- muestra la sección de pago
   * alternativo (e-transfer/cheque/efectivo + recibo firmado). NO es un
   * requisito del Protocolo de Cierre Externo de 5 puntos (T_out no la
   * exige) -- es información operativa adicional para contabilidad (E9).
   */
  noSmartphoneFlow?: boolean;
}

/**
 * v8.3 E4.11 — UI del Protocolo de Cierre Externo. Registra los dos
 * requisitos que no viven en el checklist: implementos confirmados y
 * confirmación externa. T_out (en route.ts) rechaza el cierre si esto no
 * está guardado, junto con el checklist 100% y las fotos por zona.
 */
export function ClosureProtocolPanel({ orderId, noSmartphoneFlow }: ClosureProtocolPanelProps) {
  const [implementsConfirmed, setImplementsConfirmed] = useState(false);
  const [externalType, setExternalType] = useState<ExternalConfirmationType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  // Antes save() ya hacía rollback de un toggle fallido pero nunca mostraba
  // nada -- el empleado veía un botón "que se destildó solo" sin saber por
  // qué, justo en la pantalla que bloquea Finish Service.
  const [saveError, setSaveError] = useState("");

  const [altPaymentMethod, setAltPaymentMethod] = useState<AltPaymentMethod | null>(null);
  const [altPaymentAmount, setAltPaymentAmount] = useState<string>("");
  const [altPaymentSignatureUrl, setAltPaymentSignatureUrl] = useState<string | null>(null);
  const [uploadingSignature, setUploadingSignature] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      try {
        const res = await fetch(`/api/employee/close?orderId=${orderId}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setImplementsConfirmed(!!data.implementsConfirmed);
          setExternalType(data.externalConfirmationType || null);
          setAltPaymentMethod(data.altPaymentMethod || null);
          setAltPaymentAmount(data.altPaymentAmount != null ? String(data.altPaymentAmount) : "");
          setAltPaymentSignatureUrl(data.altPaymentSignatureUrl || null);
        }
      } catch (e) {
        console.error("Load closure error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(JSON.stringify(patch));
    setSaveError("");
    try {
      const res = await fetch("/api/employee/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderId, ...patch }),
      });
      if (res.ok) return true;
      const err = await res.json().catch(() => ({}));
      console.error("Save closure error:", err.error || res.status);
      setSaveError(err.error || "Couldn't save this step of the closure protocol. Please try again.");
      return false;
    } catch (e) {
      console.error("Save closure error:", e);
      setSaveError("Connection error saving the closure protocol. Please try again.");
      return false;
    } finally {
      setSaving(null);
    }
  };

  const toggleImplements = async () => {
    const next = !implementsConfirmed;
    setImplementsConfirmed(next);
    const ok = await save({ implementsConfirmed: next });
    if (!ok) setImplementsConfirmed(!next);
  };

  const chooseExternal = async (type: ExternalConfirmationType) => {
    const prev = externalType;
    setExternalType(type);
    const ok = await save({ externalConfirmationType: type });
    if (!ok) setExternalType(prev);
  };

  // v8.3 E6.6: sube la foto del recibo firmado al mismo bucket de evidencia
  // (service-photos) que las fotos del checklist, mismo patrón que
  // ChecklistCierre.tsx handleItemPhoto.
  const handleSignaturePhoto = async (file: File) => {
    setUploadingSignature(true);
    // v8.3 ROUND 4 fix (#7): un fallo de storage.upload solo hacía
    // console.error -- el botón "Photo of signed receipt (required)" se
    // quedaba en "Uploading..." (o volvía a su estado inicial) sin ninguna
    // explicación visible, y como confirmAltPayment está deshabilitado sin
    // altPaymentSignatureUrl, el empleado quedaba bloqueado sin saber por
    // qué. Reusa el mismo ErrorBanner/saveError que ya usa save() arriba.
    setSaveError("");
    try {
      const fileExt = file.name.split(".").pop() || "jpg";
      const fileName = `${orderId}/alt-payment-receipt/${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("service-photos")
        .upload(fileName, file, { contentType: file.type });
      if (uploadError) {
        console.error("Signature upload error:", uploadError);
        setSaveError("Couldn't upload the receipt photo. Please try again.");
        return;
      }
      const { data: publicUrlData } = supabase.storage.from("service-photos").getPublicUrl(fileName);
      setAltPaymentSignatureUrl(publicUrlData.publicUrl);
    } catch (e) {
      console.error("Signature photo error:", e);
      setSaveError("Connection error uploading the receipt photo. Please try again.");
    } finally {
      setUploadingSignature(false);
    }
  };

  const chooseAltPaymentMethod = async (method: AltPaymentMethod) => {
    const prev = altPaymentMethod;
    setAltPaymentMethod(method);
    // No se guarda todavía -- falta el recibo firmado. Se envía junto con la
    // confirmación (confirmAltPayment) para respetar la validación del
    // servidor: altPaymentMethod requiere altPaymentSignatureUrl.
    if (!altPaymentSignatureUrl) return;
    const ok = await save({
      altPaymentMethod: method,
      altPaymentAmount: altPaymentAmount ? Number(altPaymentAmount) : null,
      altPaymentSignatureUrl,
    });
    if (!ok) setAltPaymentMethod(prev);
  };

  const confirmAltPayment = async () => {
    if (!altPaymentMethod || !altPaymentSignatureUrl) return;
    await save({
      altPaymentMethod,
      altPaymentAmount: altPaymentAmount ? Number(altPaymentAmount) : null,
      altPaymentSignatureUrl,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-brand-navy" />
        <span className="font-semibold text-sm text-brand-ink">External Closure Protocol</span>
      </div>

      <ErrorBanner message={saveError} />

      <button
        type="button"
        onClick={toggleImplements}
        disabled={saving !== null}
        className={`w-full flex items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
          implementsConfirmed
            ? "bg-state-success/10 border-state-success text-state-success"
            : "bg-gray-50 border-gray-300 text-gray-700"
        }`}
      >
        <span
          className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
            implementsConfirmed ? "bg-state-success border-state-success text-white" : "border-gray-300 bg-white"
          }`}
        >
          {implementsConfirmed && <Check className="w-3.5 h-3.5" />}
        </span>
        Equipment / supplies confirmed
      </button>

      <div className="space-y-2">
        <p className="text-xs text-gray-500 font-medium">External confirmation (required to finish)</p>
        {EXTERNAL_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => chooseExternal(opt.value)}
            disabled={saving !== null}
            className={`w-full flex items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
              externalType === opt.value
                ? "bg-brand-navy/10 border-brand-navy text-brand-navy"
                : "bg-gray-50 border-gray-300 text-gray-700"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
                externalType === opt.value ? "bg-brand-navy border-brand-navy text-white" : "border-gray-300 bg-white"
              }`}
            >
              {externalType === opt.value && <Check className="w-3.5 h-3.5" />}
            </span>
            {opt.label}
          </button>
        ))}
      </div>

      {/* v8.3 E6.6: pago alternativo -- solo visible para clientes en el
          flujo sin smartphone. No bloquea T_out; es información extra para
          contabilidad (E9). */}
      {noSmartphoneFlow && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
            <Banknote className="w-3.5 h-3.5" />
            Alternate payment (client has no smartphone) — optional
          </p>
          <div className="flex gap-2">
            {ALT_PAYMENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => chooseAltPaymentMethod(opt.value)}
                disabled={saving !== null}
                className={`flex-1 rounded-lg border p-2 text-xs font-medium transition-colors ${
                  altPaymentMethod === opt.value
                    ? "bg-brand-navy/10 border-brand-navy text-brand-navy"
                    : "bg-gray-50 border-gray-300 text-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {altPaymentMethod && (
            <div className="space-y-2">
              <label className="block text-xs text-gray-600">
                Amount received ($ CAD)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label="Alternate payment amount"
                  value={altPaymentAmount}
                  onChange={(e) => setAltPaymentAmount(e.target.value)}
                  className="w-full border rounded-lg p-2 text-sm mt-1"
                />
              </label>

              <div>
                {altPaymentSignatureUrl ? (
                  <Image
                    src={altPaymentSignatureUrl}
                    alt="Signed receipt"
                    width={80}
                    height={80}
                    className="w-20 h-20 rounded-lg object-cover border"
                  />
                ) : (
                  <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer hover:text-brand-gold-dark">
                    <Camera className="w-3.5 h-3.5" />
                    <span>{uploadingSignature ? "Uploading..." : "Photo of signed receipt (required)"}</span>
                    <input
                      type="file"
                      aria-label="Photo of signed alternate payment receipt"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleSignaturePhoto(file);
                      }}
                      disabled={uploadingSignature}
                    />
                  </label>
                )}
              </div>

              <button
                type="button"
                onClick={confirmAltPayment}
                disabled={saving !== null || !altPaymentSignatureUrl}
                className="w-full bg-brand-navy text-white rounded-lg py-2 text-xs font-semibold disabled:opacity-40"
              >
                Confirm alternate payment
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
