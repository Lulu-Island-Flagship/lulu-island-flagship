"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Clock, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { EmpleadoBackHeader } from "@/components/empleado/EmpleadoBackHeader";

interface RestPeriod {
  id: string;
  work_date: string;
  rest_start_at: string;
  rest_end_at: string;
  duration_minutes: number;
  role_during_rest: "driver" | "passenger" | "solo_no_vehicle";
  satisfies_esa_break: boolean;
  reason: string;
}

/**
 * v8.3 (BC ESA s.32) — Mis descansos documentados. Muestra el tránsito
 * entre servicios y si calificó como el descanso legal de 30 min. Si el
 * rol ese día fue 'driver', nunca cuenta como descanso porque manejar
 * sigue siendo trabajo — se explica en pantalla para que quede claro por
 * qué, no solo el resultado.
 */
export default function DescansosPage() {
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const backHref = `/${locale}/employee`;
  const t = useTranslations("employee.restsScreen");
  const [periods, setPeriods] = useState<RestPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/employee/rest-periods", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("loadError"));
      setPeriods(data.periods || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  const roleLabel = (role: RestPeriod["role_during_rest"]) => {
    switch (role) {
      case "driver":
        return t("roleDriver");
      case "passenger":
        return t("rolePassenger");
      case "solo_no_vehicle":
        return t("roleSoloNoVehicle");
      default:
        return role;
    }
  };

  return (
    <main className="min-h-screen bg-brand-ice">
      <EmpleadoBackHeader title={t("title")} backHref={backHref} />
      <div className="p-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="w-6 h-6 text-brand-navy" />
        <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
      </div>
      <p className="text-sm text-gray-500">
        {t("description")}
      </p>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
        </div>
      ) : (
        <div className="space-y-2">
          {periods.map((p) => (
            <div key={p.id} className="bg-white rounded-lg shadow-elevation-1 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.work_date}</span>
                <span
                  className={`text-xs flex items-center gap-1 ${
                    p.satisfies_esa_break ? "text-state-success" : "text-gray-400"
                  }`}
                >
                  {p.satisfies_esa_break ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5" />
                  )}
                  {p.satisfies_esa_break ? t("countedAsBreak") : t("notABreak")}
                </span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {t("transitMinutes", { minutes: p.duration_minutes, role: roleLabel(p.role_during_rest) })}
              </div>
            </div>
          ))}
          {periods.length === 0 && (
            <div className="text-xs text-gray-400">{t("noRecords")}</div>
          )}
        </div>
      )}
      </div>
    </main>
  );
}
