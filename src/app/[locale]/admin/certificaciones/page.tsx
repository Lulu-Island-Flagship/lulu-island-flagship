"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Loader2, ShieldCheck, AlertTriangle, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

interface Certification {
  id: string;
  level: 1 | 2 | 3;
  certificate_type: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: "valid" | "expiring_soon" | "expired" | "revoked" | "none";
}

interface EmployeeRow {
  employee: { id: string; name: string; role: string; is_active: boolean };
  certifications: Certification[];
  assignable: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  valid: "text-green-700 bg-green-50",
  expiring_soon: "text-amber-700 bg-amber-50",
  expired: "text-red-700 bg-red-50",
  revoked: "text-gray-500 bg-gray-100",
};

/**
 * v8.3 E9.4 / E7 / D.9 Doc 3 — Certificación química de 3 niveles con
 * vencimiento REAL. "no asignable sin vigencia": el cron dispatch-scheduler
 * excluye del despacho a un empleado con TODOS sus registros
 * vencidos/revocados (ver nota de "cláusula de transición" en ese cron --
 * un empleado sin ningún registro aún no se bloquea retroactivamente).
 */
export default function CertificacionesPage() {
  const t = useTranslations("admin.certificaciones");
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [blockedCount, setBlockedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ employeeId: "", level: "1", expiresAt: "" });
  // 2026-07-24 fix: reemplaza window.prompt("Revocation reason:") por
  // ConfirmActionModal — guarda el id de la certificación a revocar mientras
  // el modal está abierto.
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/certifications", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errors.loadFailed"));
      setRows(data.employees || []);
      setBlockedCount(data.blockedCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addCertification() {
    if (!form.employeeId || !form.expiresAt) return;
    setError("");
    try {
      const res = await fetch("/api/admin/certifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          employeeId: form.employeeId,
          level: parseInt(form.level, 10),
          expiresAt: new Date(form.expiresAt).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errors.genericFailed"));
      setForm({ employeeId: "", level: "1", expiresAt: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.network"));
    }
  }

  async function revoke(id: string, reason: string) {
    const res = await fetch(`/api/admin/certifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("errors.genericFailed"));
    await load();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-6 h-6" />
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">{t("subtitle")}</p>

      {blockedCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded p-3 text-sm border bg-red-50 border-red-200 text-red-700">
          <AlertTriangle className="w-4 h-4" />
          {t("blockedBanner", { count: blockedCount })}
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      <div className="bg-white rounded border border-gray-200 p-4 mb-6">
        <h2 className="font-semibold mb-3 text-sm">{t("registerForm.title")}</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <select
            aria-label={t("registerForm.employeeAria")}
            value={form.employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
            className="border rounded px-2 py-1.5 text-sm"
          >
            <option value="">{t("registerForm.selectEmployee")}</option>
            {rows.map((r) => (
              <option key={r.employee.id} value={r.employee.id}>
                {r.employee.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("registerForm.levelAria")}
            value={form.level}
            onChange={(e) => setForm({ ...form, level: e.target.value })}
            className="border rounded px-2 py-1.5 text-sm"
          >
            <option value="1">{t("registerForm.level", { level: 1 })}</option>
            <option value="2">{t("registerForm.level", { level: 2 })}</option>
            <option value="3">{t("registerForm.level", { level: 3 })}</option>
          </select>
          <input
            type="date"
            aria-label={t("registerForm.expiresAria")}
            value={form.expiresAt}
            onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            className="border rounded px-2 py-1.5 text-sm"
          />
          <button
            onClick={addCertification}
            className="bg-brand-navy text-white text-sm px-3 py-1.5 rounded"
          >
            {t("registerForm.add")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.employee.id} className="bg-white rounded border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">
                  {r.employee.name}{" "}
                  <span className="text-xs text-gray-400">
                    ({r.employee.role}, {r.employee.is_active ? t("active") : t("inactive")})
                  </span>
                </div>
                {r.employee.is_active && !r.assignable && r.certifications.length > 0 && (
                  <span className="text-xs text-red-600 font-medium">{t("blockedFromDispatch")}</span>
                )}
              </div>
              {r.certifications.length === 0 ? (
                <div className="text-xs text-gray-400">{t("noCertification")}</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {r.certifications.map((c) => (
                    <span
                      key={c.id}
                      className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${STATUS_STYLE[c.status] || ""}`}
                    >
                      {t("certBadge", {
                        level: c.level,
                        date: new Date(c.expires_at).toLocaleDateString("en-CA"),
                        status: t(`statusLabels.${c.status}`),
                      })}
                      {!c.revoked_at && (
                        <button
                          onClick={() => setRevokingId(c.id)}
                          aria-label={t("revokeAriaLabel")}
                          className="ml-1 hover:opacity-70"
                        >
                          <XCircle className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {revokingId && (
        <ConfirmActionModal
          title={t("revokeModal.title")}
          message={t("revokeModal.message")}
          confirmLabel={t("revokeModal.confirm")}
          danger
          fields={[{ key: "reason", label: t("revokeModal.reasonLabel"), autoFocus: true }]}
          onCancel={() => setRevokingId(null)}
          onConfirm={async (values) => {
            await revoke(revokingId, values.reason);
            setRevokingId(null);
          }}
        />
      )}
    </div>
  );
}
