"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Video, Award, CheckCircle2 } from "lucide-react";
import { EmpleadoBackHeader } from "@/components/empleado/EmpleadoBackHeader";

interface Feature {
  id: string;
  feature_type: "day_in_life_reel" | "public_badge_showcase";
  employee_consented_at: string | null;
  employee_consent_withdrawn_at: string | null;
  admin_approved_at: string | null;
  visibility: string;
}

const FEATURE_TYPES: Array<{ type: Feature["feature_type"]; label: string; description: string; icon: typeof Video }> = [
  {
    type: "day_in_life_reel",
    label: "Day-in-the-life reel",
    description: "A short video showing what a normal day looks like on the job, used for social media / recruiting.",
    icon: Video,
  },
  {
    type: "public_badge_showcase",
    label: "Public badge showcase",
    description: "Your earned badges shown on the public website.",
    icon: Award,
  },
];

export default function EmployeeMarketingConsentPage() {
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const backHref = `/${locale}/empleado`;
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/empleado/marketing-consent", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setFeatures(data.features || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggle(featureType: string, currentlyConsented: boolean) {
    setBusyType(featureType);
    setError("");
    try {
      const res = await fetch("/api/empleado/marketing-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: currentlyConsented ? "withdraw" : "consent", featureType }),
      });
      if (res.ok) await load();
      else {
        const err = await res.json();
        setError(err.error || "Failed to update");
      }
    } finally {
      setBusyType(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-ice">
        <EmpleadoBackHeader title="Marketing consent" backHref={backHref} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <EmpleadoBackHeader title="Marketing consent" backHref={backHref} />
      <div className="space-y-4 max-w-lg mx-auto px-4 py-6">
      <div>
        <h1 className="text-xl font-bold text-brand-ink">Marketing consent</h1>
        <p className="text-sm text-gray-500 mt-1">
          These are 100% optional. You can withdraw your consent at any time — doing so immediately removes
          anything published, even if it was already approved.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

      {FEATURE_TYPES.map(({ type, label, description, icon: Icon }) => {
        const existing = features.find((f) => f.feature_type === type);
        const consented = !!existing?.employee_consented_at && !existing?.employee_consent_withdrawn_at;
        return (
          <div key={type} className="bg-white rounded-xl border p-4 flex items-start gap-3">
            <Icon className="w-6 h-6 text-brand-navy shrink-0 mt-1" />
            <div className="flex-1">
              <p className="font-medium text-brand-ink text-sm">{label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{description}</p>
              {existing?.visibility === "visible" && (
                <p className="text-xs text-state-success flex items-center gap-1 mt-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Currently live on the site
                </p>
              )}
            </div>
            <button
              onClick={() => toggle(type, consented)}
              disabled={busyType === type}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                // Auditoría UX/seguridad 2026-07-25 (#13): el estilo gris
                // apagado hacía que "Withdraw" pareciera un botón
                // deshabilitado en vez de una acción disponible -- ahora
                // usa un color de acción real (borde/texto rojo, con hover
                // sólido) para que se lea como clickeable.
                consented
                  ? "bg-white border border-state-danger text-state-danger hover:bg-state-danger hover:text-white"
                  : "bg-brand-navy text-white hover:bg-brand-navy-light"
              }`}
            >
              {busyType === type ? "..." : consented ? "Withdraw" : "I consent"}
            </button>
          </div>
        );
      })}
      </div>
    </main>
  );
}
