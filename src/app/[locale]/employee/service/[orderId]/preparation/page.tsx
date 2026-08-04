"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Info, AlertTriangle, ShieldAlert } from "lucide-react";
import { EmpleadoBackHeader } from "@/components/empleado/EmpleadoBackHeader";

type Severity = "info" | "caution" | "critical";

interface BriefingTip {
  key: string;
  message: string;
  severity: Severity;
}

const SEVERITY_STYLE: Record<Severity, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "bg-blue-50 text-blue-800 border-blue-200" },
  caution: { icon: AlertTriangle, className: "bg-amber-50 text-amber-800 border-amber-200" },
  critical: { icon: ShieldAlert, className: "bg-red-50 text-red-800 border-red-200" },
};

/** v8.3 E8.7 — Preparación por servicio: tips contextuales antes de empezar. */
export default function ServiceBriefingPage() {
  const params = useParams();
  const orderId = params?.orderId as string;
  const locale = (params?.locale as string) || "en";

  const [tips, setTips] = useState<BriefingTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/employee/service/${orderId}/briefing`, { credentials: "include" });
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || "No se pudo cargar");
          return;
        }
        const data = await res.json();
        setTips(data.tips || []);
      } catch {
        setError("Error de red");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [orderId]);

  const backHref = `/${locale}/employee/service/${orderId}`;

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-ice">
        <EmpleadoBackHeader title="Service Prep" backHref={backHref} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <EmpleadoBackHeader title="Service Prep" backHref={backHref} />
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4 max-w-md mx-auto">
      <h1 className="text-lg font-bold text-brand-ink">Service Prep</h1>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

      {tips.length === 0 ? (
        <p className="text-sm text-gray-500">Sin observaciones especiales para este servicio.</p>
      ) : (
        <div className="space-y-2">
          {tips.map((tip) => {
            const style = SEVERITY_STYLE[tip.severity];
            const Icon = style.icon;
            return (
              <div key={tip.key} className={`border rounded-lg p-3 text-sm flex items-start gap-2 ${style.className}`}>
                <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{tip.message}</span>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </main>
  );
}
