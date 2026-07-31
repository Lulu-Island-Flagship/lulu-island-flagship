"use client";

/**
 * v8.3 E0-C4 — Panel de Feature Flags (wireframe aprobado por el dueño 2026-07-08):
 * agrupados por módulo (colapsables), toggle con confirmación, ⓘ descripción,
 * banner amarillo si un flag crítico (P0) lleva >7 días apagado.
 * Acceso: solo rol owner_admin (la API lo exige; esta página solo renderiza).
 */

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, ChevronDown, ChevronRight, Info, AlertTriangle, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAdminRoles } from "@/lib/useAdminRoles";
import { roleAllows } from "@/lib/admin-rbac";

interface Flag {
  nombre: string;
  activo: boolean;
  modulo: string | null;
  descripcion: string | null;
  es_critico: boolean;
  updated_at: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default function FeatureFlagsPage() {
  const t = useTranslations("admin.featureFlags");
  const tLayout = useTranslations("admin.layout");
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  // Fix (auditoría 2026-07-30, item 5): página owner-only (API protegida por
  // requireAdminRole("feature_flags"), solo owner_admin) sin chequeo
  // explícito de rol -- un no-owner veía el loader y luego un 403 crudo.
  // Mismo patrón aplicado en seguridad/page.tsx.
  const { roles, loading: rolesLoading } = useAdminRoles();
  const hasAccess = roleAllows(roles, "feature_flags");
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<Flag | null>(null);
  const [saving, setSaving] = useState(false);
  const [infoOpen, setInfoOpen] = useState<string | null>(null);

  useEffect(() => {
    if (rolesLoading || !hasAccess) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesLoading, hasAccess]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/feature-flags");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("errorLoading"));
      setFlags(json.flags);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setLoading(false);
    }
  }

  async function applyToggle(flag: Flag) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: flag.nombre, activo: !flag.activo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("errorSaving"));
      setFlags((prev) =>
        prev.map((f) => (f.nombre === flag.nombre ? { ...f, ...json.flag } : f))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setSaving(false);
      setConfirming(null);
    }
  }

  const filtered = useMemo(
    () =>
      flags.filter(
        (f) =>
          !search ||
          f.nombre.toLowerCase().includes(search.toLowerCase()) ||
          (f.descripcion ?? "").toLowerCase().includes(search.toLowerCase())
      ),
    [flags, search]
  );

  const byModule = useMemo(() => {
    const groups: Record<string, Flag[]> = {};
    for (const f of filtered) {
      const key = f.modulo || t("noModule");
      (groups[key] ??= []).push(f);
    }
    return groups;
  }, [filtered]);

  const staleCritical = useMemo(
    () =>
      flags.filter(
        (f) =>
          f.es_critico &&
          !f.activo &&
          Date.now() - new Date(f.updated_at).getTime() > SEVEN_DAYS_MS
      ),
    [flags]
  );

  if (rolesLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-brand-navy">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-md w-full text-center space-y-4">
          <Lock className="h-8 w-8 text-brand-navy mx-auto" />
          <h1 className="text-xl font-bold text-brand-ink">{tLayout("accessTitle")}</h1>
          <p className="text-sm text-gray-500">{tLayout("accessDenied")}</p>
          <Link
            href={`/${locale}/admin`}
            className="inline-block bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            {tLayout("goHome")}
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-brand-navy">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-brand-navy">{t("title")}</h1>
        <input
          type="text"
          aria-label={t("searchFlags")}
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-brand-ice rounded-md px-3 py-1.5 text-sm"
        />
      </div>

      {staleCritical.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-state-warning bg-amber-50 p-3 text-sm text-brand-ink">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-state-warning shrink-0" />
          <span>
            {t("staleCriticalWarning", { count: staleCritical.length })}{" "}
            <strong>{staleCritical.map((f) => f.nombre).join(", ")}</strong>
          </span>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-state-danger bg-red-50 p-3 text-sm text-state-danger">
          {error}
        </div>
      )}

      {Object.entries(byModule).map(([mod, group]) => (
        <div key={mod} className="mb-4 rounded-lg border border-brand-ice bg-white shadow-elevation-1">
          <button
            onClick={() => setCollapsed((c) => ({ ...c, [mod]: !c[mod] }))}
            className="flex w-full items-center gap-2 px-4 py-3 text-left font-medium text-brand-navy"
          >
            {collapsed[mod] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {mod}
            <span className="ml-auto text-xs text-gray-400">
              {t("activeCount", { active: group.filter((f) => f.activo).length, total: group.length })}
            </span>
          </button>

          {!collapsed[mod] &&
            group.map((flag) => (
              <div
                key={flag.nombre}
                className="flex items-center gap-3 border-t border-brand-ice px-4 py-3"
              >
                <code className="text-sm text-brand-ink">{flag.nombre}</code>
                {flag.es_critico && (
                  <span className="rounded bg-brand-navy px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    P0
                  </span>
                )}
                <button
                  onClick={() => setInfoOpen(infoOpen === flag.nombre ? null : flag.nombre)}
                  className="text-gray-400 hover:text-brand-wave-blue"
                  aria-label={t("descriptionOf", { name: flag.nombre })}
                >
                  <Info className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setConfirming(flag)}
                  disabled={saving}
                  role="switch"
                  aria-checked={flag.activo}
                  aria-label={`${flag.activo ? t("turnOff") : t("turnOn")} ${flag.nombre}`}
                  className={`ml-auto relative h-6 w-11 rounded-full transition-colors ${
                    flag.activo ? "bg-state-success" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      flag.activo ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
                {infoOpen === flag.nombre && (
                  <p className="w-full basis-full pt-1 text-xs text-gray-500">
                    {flag.descripcion || t("noDescription")}
                  </p>
                )}
              </div>
            ))}
        </div>
      ))}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white p-6 shadow-elevation-3">
            <h2 className="mb-2 font-semibold text-brand-navy">
              {confirming.activo ? t("turnOff") : t("turnOn")} {confirming.nombre}?
            </h2>
            <p className="mb-4 text-sm text-gray-600">
              {confirming.descripcion || t("switchDescriptionFallback")}
              {confirming.es_critico && confirming.activo && (
                <span className="mt-2 block font-medium text-state-danger">
                  {t("criticalFlagWarning")}
                </span>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="rounded-md border border-brand-ice px-4 py-2 text-sm"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => applyToggle(confirming)}
                disabled={saving}
                className="rounded-md bg-brand-navy px-4 py-2 text-sm text-white"
              >
                {saving ? t("saving") : t("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
