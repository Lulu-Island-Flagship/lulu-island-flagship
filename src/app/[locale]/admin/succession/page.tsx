"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Users, Plus, ShieldAlert, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

interface Successor {
  id: string;
  name: string;
  relationship: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  is_active: boolean;
}

interface SuccessionStatus {
  status: "normal" | "burnout_alert" | "succession_alert" | "auto_activate" | "manually_activated";
  last_evaluated_at: string;
  activated_at: string | null;
  activated_reason: string | null;
}

const STATUS_STYLE: Record<SuccessionStatus["status"], { className: string; icon: typeof CheckCircle2 }> = {
  normal: { className: "bg-green-50 text-green-700", icon: CheckCircle2 },
  burnout_alert: { className: "bg-amber-50 text-amber-700", icon: AlertTriangle },
  succession_alert: { className: "bg-orange-50 text-orange-700", icon: AlertTriangle },
  auto_activate: { className: "bg-red-50 text-red-700", icon: ShieldAlert },
  manually_activated: { className: "bg-red-100 text-red-800", icon: ShieldAlert },
};

export default function SuccessionPage() {
  const t = useTranslations("admin.succession");
  const [status, setStatus] = useState<SuccessionStatus | null>(null);
  const [successors, setSuccessors] = useState<Successor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", relationship: "", contactPhone: "", contactEmail: "" });
  // 2026-07-24 fix: reemplaza window.confirm("Remove this trusted successor?")
  // por ConfirmActionModal.
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/succession", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setStatus(data.status);
      setSuccessors(data.successors || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function addSuccessor(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/succession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "add_successor",
          name: form.name.trim(),
          relationship: form.relationship.trim() || undefined,
          contactPhone: form.contactPhone.trim() || undefined,
          contactEmail: form.contactEmail.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.saveFailed"));
        return;
      }
      setForm({ name: "", relationship: "", contactPhone: "", contactEmail: "" });
      setShowForm(false);
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    const res = await fetch("/api/admin/succession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "deactivate_successor", id }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || t("errors.generic"));
    }
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  const statusStyle = status ? STATUS_STYLE[status.status] : STATUS_STYLE.normal;
  const StatusIcon = statusStyle.icon;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className={`rounded-xl border p-4 flex items-center gap-3 ${statusStyle.className}`}>
        <StatusIcon className="w-6 h-6 shrink-0" />
        <div>
          <p className="font-semibold">{status ? t(`statuses.${status.status}`) : t("statuses.normal")}</p>
          {status?.activated_reason && <p className="text-sm mt-0.5">{status.activated_reason}</p>}
          {status?.last_evaluated_at && (
            <p className="text-xs opacity-70 mt-0.5">
              {t("lastEvaluated", { datetime: new Date(status.last_evaluated_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" }) })}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-brand-ink flex items-center gap-2">
          <Users className="w-4 h-4 text-brand-wave-blue" />
          {t("trustedSuccessors")}
        </h2>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 text-sm text-brand-navy hover:underline"
        >
          <Plus className="w-4 h-4" /> {t("add")}
        </button>
      </div>

      {showForm && (
        <form onSubmit={addSuccessor} className="bg-white rounded-xl border p-4 space-y-3">
          <input
            aria-label={t("form.nameAria")}
            type="text"
            placeholder={t("form.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            required
          />
          <input
            aria-label={t("form.relationshipAria")}
            type="text"
            placeholder={t("form.relationshipPlaceholder")}
            value={form.relationship}
            onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              aria-label={t("form.phoneAria")}
              type="tel"
              placeholder={t("form.phonePlaceholder")}
              value={form.contactPhone}
              onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <input
              aria-label={t("form.emailAria")}
              type="email"
              placeholder={t("form.emailPlaceholder")}
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              aria-label={t("form.saveAria")}
              disabled={saving}
              className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? t("form.saving") : t("form.save")}
            </button>
            <button type="button" aria-label={t("form.cancelAria")} onClick={() => setShowForm(false)} className="text-sm text-gray-500 px-4 py-2">
              {t("form.cancel")}
            </button>
          </div>
        </form>
      )}

      {successors.length === 0 ? (
        <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
          {t("emptyState")}
        </div>
      ) : (
        <div className="bg-white rounded-xl border divide-y">
          {successors.map((s) => (
            <div key={s.id} className="p-3 flex items-center justify-between">
              <div>
                <p className="font-medium text-brand-ink text-sm">{s.name}</p>
                <p className="text-xs text-gray-500">
                  {[s.relationship, s.contact_phone, s.contact_email].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button aria-label={t("removeSuccessorAria", { name: s.name })} onClick={() => setDeactivatingId(s.id)} className="text-gray-400 hover:text-red-500">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {deactivatingId && (
        <ConfirmActionModal
          title={t("removeModal.title")}
          confirmLabel={t("removeModal.confirmLabel")}
          danger
          onCancel={() => setDeactivatingId(null)}
          onConfirm={async () => {
            await deactivate(deactivatingId);
            setDeactivatingId(null);
          }}
        />
      )}
    </div>
  );
}
