"use client";

import React, { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";

type ExternalConfirmationType = "client_verbal" | "leader_audit" | "auditor_present";

const EXTERNAL_OPTIONS: { value: ExternalConfirmationType; label: string }[] = [
  { value: "client_verbal", label: "Client approved verbally" },
  { value: "leader_audit", label: "Leader visual audit + closing photo" },
  { value: "auditor_present", label: "Auditor present" },
];

interface ClosureProtocolPanelProps {
  orderId: string;
}

/**
 * v8.3 E4.11 — UI del Protocolo de Cierre Externo. Registra los dos
 * requisitos que no viven en el checklist: implementos confirmados y
 * confirmación externa. T_out (en route.ts) rechaza el cierre si esto no
 * está guardado, junto con el checklist 100% y las fotos por zona.
 */
export function ClosureProtocolPanel({ orderId }: ClosureProtocolPanelProps) {
  const [implementsConfirmed, setImplementsConfirmed] = useState(false);
  const [externalType, setExternalType] = useState<ExternalConfirmationType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      try {
        const res = await fetch(`/api/empleado/cierre?orderId=${orderId}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setImplementsConfirmed(!!data.implementsConfirmed);
          setExternalType(data.externalConfirmationType || null);
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
    try {
      const res = await fetch("/api/empleado/cierre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderId, ...patch }),
      });
      if (res.ok) return true;
      return false;
    } catch (e) {
      console.error("Save closure error:", e);
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
    </div>
  );
}
