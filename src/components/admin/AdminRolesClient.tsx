"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mail, Shield, AlertCircle, UserPlus, UserMinus } from "lucide-react";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

interface AdminRoleRow {
  id: string;
  user_id: string;
  role: "owner_admin" | "ops_coordinator" | "qc_only";
  granted_by: string | null;
  created_at: string;
  email: string | null;
}

const ROLE_BADGE: Record<AdminRoleRow["role"], string> = {
  owner_admin: "bg-brand-gold/20 text-brand-gold-dark",
  ops_coordinator: "bg-purple-100 text-purple-700",
  qc_only: "bg-blue-100 text-blue-700",
};

/**
 * v8.3 B-2 (auditoría go-live 2026-07-20) — UI de alta/baja de roles
 * administrativos (owner_admin/ops_coordinator/qc_only). Antes de este fix
 * no existía ninguna pantalla para esto -- ver POST /api/admin/roles.
 * Enlazada desde AdminNav.tsx (grupo "Finance & Settings", resource
 * "admin_roles_management", solo owner_admin).
 */
export default function AdminRolesClient() {
  const t = useTranslations("admin.roles");
  const ROLE_LABEL: Record<AdminRoleRow["role"], string> = {
    owner_admin: t("roleLabels.ownerAdmin"),
    ops_coordinator: t("roleLabels.opsCoordinator"),
    qc_only: t("roleLabels.qcOnly"),
  };
  const [roles, setRoles] = useState<AdminRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  // 2026-07-24 fix: reemplaza confirm("Revoke this admin role? ...") por
  // ConfirmActionModal — guarda el id del rol pendiente de confirmar.
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  useEffect(() => {
    loadRoles();
  }, []);

  async function loadRoles() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/roles", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("loadError"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setRoles(data.roles || []);
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function revokeRole(id: string) {
    setRevokingId(id);
    setRevokeError("");
    try {
      const res = await fetch(`/api/admin/roles?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("revokeErrorFallback"));
      setRoles((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : t("revokeErrorFallback"));
      throw err;
    } finally {
      setRevokingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700 font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">{t("heading")}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {t("roleCount", { count: roles.length })}
          </span>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light"
          >
            <UserPlus className="w-4 h-4" />
            {t("grantRole")}
          </button>
        </div>
      </div>

      {revokeError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-state-danger">
          {revokeError}
        </div>
      )}

      {roles.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Shield className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("emptyState")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("table.email")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("table.role")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("table.granted")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600"><span className="sr-only">{t("table.actions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {roles.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Mail className="w-4 h-4 text-gray-400" />
                        <span>{r.email || r.user_id}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_BADGE[r.role]}`}>
                        <Shield className="w-3 h-3 inline mr-1" />
                        {ROLE_LABEL[r.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setConfirmRevokeId(r.id)}
                        disabled={revokingId === r.id}
                        aria-label={t("revokeAriaLabel", { role: ROLE_LABEL[r.role], target: r.email || r.user_id })}
                        className="flex items-center gap-1 text-xs text-state-danger hover:opacity-80 disabled:opacity-50"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        {revokingId === r.id ? t("revoking") : t("revoke")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddRoleModal
          onClose={() => setShowAddModal(false)}
          onCreated={(role) => {
            setRoles((prev) => [...prev, role]);
            setShowAddModal(false);
          }}
        />
      )}

      {confirmRevokeId && (
        <ConfirmActionModal
          title={t("confirmRevoke.title")}
          message={t("confirmRevoke.message")}
          confirmLabel={t("confirmRevoke.confirmLabel")}
          danger
          onCancel={() => setConfirmRevokeId(null)}
          onConfirm={async () => {
            await revokeRole(confirmRevokeId);
            setConfirmRevokeId(null);
          }}
        />
      )}
    </div>
  );
}

function AddRoleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (role: AdminRoleRow) => void;
}) {
  const t = useTranslations("admin.roles");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRoleRow["role"]>("ops_coordinator");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const handleCreate = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("addModal.grantErrorFallback"));
      onCreated(data.role);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("addModal.grantErrorFallback"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-brand-ink">{t("addModal.title")}</h2>
        <p className="text-xs text-gray-500">
          {t("addModal.subtitle")}
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="add-role-email" className="text-xs text-gray-600 block mb-1">{t("addModal.emailLabel")}</label>
            <input
              id="add-role-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder={t("addModal.emailPlaceholder")}
            />
          </div>
          <div>
            <label htmlFor="add-role-role" className="text-xs text-gray-600 block mb-1">{t("addModal.roleLabel")}</label>
            <select
              id="add-role-role"
              value={role}
              onChange={(e) => setRole(e.target.value as AdminRoleRow["role"])}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="owner_admin">{t("addModal.roleOptions.ownerAdmin")}</option>
              <option value="ops_coordinator">{t("addModal.roleOptions.opsCoordinator")}</option>
              <option value="qc_only">{t("addModal.roleOptions.qcOnly")}</option>
            </select>
          </div>
        </div>

        {saveError && <p className="text-xs text-state-danger">{saveError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">
            {t("addModal.cancel")}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !email.trim()}
            aria-label={saving ? t("addModal.grantingAriaLabel") : t("addModal.grantAriaLabel")}
            className="px-4 py-2 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
          >
            {saving ? t("addModal.granting") : t("addModal.grant")}
          </button>
        </div>
      </div>
    </div>
  );
}
