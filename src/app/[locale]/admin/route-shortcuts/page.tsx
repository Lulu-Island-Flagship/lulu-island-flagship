"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPinned, Check } from "lucide-react";

interface Shortcut {
  id: string;
  employee_id: string;
  description: string;
  uses_count: number;
  reported_at: string;
  validated_at: string | null;
  employees?: { name: string } | { name: string }[] | null;
}

/**
 * v8.3 E8 FIX-4 — "Ruta con aprendizaje": un empleado reporta un atajo real
 * (empleado/checkin), un supervisor lo valida acá. Validar dispara el bono
 * de +$10 (route-shortcuts/[id]/validate/route.ts, tabla
 * employee_wellbeing_bonuses).
 */
export default function AdminRouteShortcutsPage() {
  const t = useTranslations("admin.routeShortcuts");
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [validatingId, setValidatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/route-shortcuts${pendingOnly ? "?pending=true" : ""}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setShortcuts(data.shortcuts || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [pendingOnly, t]);

  useEffect(() => {
    load();
  }, [pendingOnly, load]);

  async function validate(id: string) {
    setValidatingId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/route-shortcuts/${id}/validate`, {
        method: "PATCH",
        credentials: "include",
      });
      if (res.ok) {
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || t("errors.validateFailed"));
      }
    } catch {
      setError(t("errors.network"));
    } finally {
      setValidatingId(null);
    }
  }

  function employeeName(s: Shortcut): string {
    const e = Array.isArray(s.employees) ? s.employees[0] : s.employees;
    return e?.name || "—";
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <MapPinned className="w-5 h-5" /> {t("title")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          aria-label={t("pendingOnlyAria")}
          checked={pendingOnly}
          onChange={(e) => setPendingOnly(e.target.checked)}
        />
        {t("pendingOnlyLabel")}
      </label>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
        </div>
      ) : shortcuts.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-sm text-gray-500">
          {t("emptyState")}
        </div>
      ) : (
        <div className="space-y-2">
          {shortcuts.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-brand-ink">{employeeName(s)}</span>
                {s.validated_at ? (
                  <span className="text-xs text-green-700 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> {t("validated")}
                  </span>
                ) : (
                  <button
                    onClick={() => validate(s.id)}
                    disabled={validatingId === s.id}
                    className="text-xs bg-brand-navy text-white px-3 py-1 rounded-full font-medium disabled:opacity-50"
                  >
                    {validatingId === s.id ? "..." : t("validateAction")}
                  </button>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-2">{s.description}</p>
              <p className="text-xs text-gray-400 mt-1">{new Date(s.reported_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
