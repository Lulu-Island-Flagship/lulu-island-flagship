"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bot, HandMetal } from "lucide-react";
import { describeOperatingMode } from "@/lib/autopilot-mode";

/**
 * v8.3 E0.11 — banner visible del modo operativo global (Autopilot/Manual).
 * Lee el mismo flag que el panel de feature flags (admin_update_config,
 * snapshot/undo ya incluidos ahí) para que el modo Manual "sugiere y espera"
 * sea una señal visible en el dashboard, no solo un valor de base de datos.
 */
export default function AutopilotModeBanner({ locale }: { locale: string }) {
  const t = useTranslations("admin.autopilotBanner");
  const [activo, setActivo] = useState<boolean | null>(null);

  // Fix (auditoría 2026-07-30, item 7): antes se llamaba directo a
  // /api/admin/feature-flags, protegido por el resource RBAC "feature_flags"
  // (solo owner_admin) -- para ops_coordinator/qc_only esa llamada daba 403
  // silencioso y el banner desaparecía sin explicación, aunque el modo
  // operativo (Autopilot/Manual) es información relevante para cualquier
  // rol admin. Se usa /api/admin/operating-mode, un endpoint de solo lectura
  // que expone únicamente este booleano y es accesible a cualquier rol
  // admin real (no solo owner_admin) -- el panel completo de flags sigue
  // protegido igual que antes.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/operating-mode", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || data.activo === null || data.activo === undefined) return;
        setActivo(Boolean(data.activo));
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
        <span className="font-semibold">{t("modePrefix")} {description.label}</span>
        <span className="text-xs opacity-80 ml-2">{description.explanation}</span>
      </div>
    </a>
  );
}
