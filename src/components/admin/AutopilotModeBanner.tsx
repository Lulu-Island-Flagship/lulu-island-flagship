"use client";

import React, { useEffect, useState } from "react";
import { Bot, HandMetal } from "lucide-react";
import { AUTOPILOT_MODE_FLAG_NAME, describeOperatingMode } from "@/lib/autopilot-mode";

/**
 * v8.3 E0.11 — banner visible del modo operativo global (Autopilot/Manual).
 * Lee el mismo flag que el panel de feature flags (admin_update_config,
 * snapshot/undo ya incluidos ahí) para que el modo Manual "sugiere y espera"
 * sea una señal visible en el dashboard, no solo un valor de base de datos.
 */
export default function AutopilotModeBanner({ locale }: { locale: string }) {
  const [activo, setActivo] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/feature-flags", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const flag = (data.flags || []).find((f: { nombre: string }) => f.nombre === AUTOPILOT_MODE_FLAG_NAME);
        if (flag) setActivo(Boolean(flag.activo));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (activo === null) return null;

  const description = describeOperatingMode(activo);
  const Icon = activo ? Bot : HandMetal;

  return (
    <a
      href={`/${locale}/admin/feature-flags`}
      className={`flex items-center gap-3 rounded-xl border p-3 text-sm hover:shadow-sm transition-shadow ${
        activo ? "bg-indigo-50 border-indigo-200 text-indigo-800" : "bg-amber-50 border-amber-200 text-amber-800"
      }`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <div>
        <span className="font-semibold">Mode: {description.label}</span>
        <span className="text-xs opacity-80 ml-2">{description.explanation}</span>
      </div>
    </a>
  );
}
