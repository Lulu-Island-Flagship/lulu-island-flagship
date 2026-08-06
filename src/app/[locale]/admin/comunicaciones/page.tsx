"use client";

/**
 * v8.3 E6 — Panel de edición de plantillas de comunicación (M13).
 * Edición inline de texto por evento+idioma, sin tocar código. El
 * historial y "Deshacer" NO se construyen aquí — se reutiliza el panel
 * genérico de E0-C6 (/admin/config-history), filtrado a esta tabla.
 * Acceso: la API exige rol owner_admin (recurso RBAC "finance").
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, Pencil, History, Save, X, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

interface TemplateRow {
  id: string;
  event_key: string;
  language: string;
  version: number;
  subject: string | null;
  body: string;
  is_current: boolean;
  created_at: string;
}

interface EventRow {
  event_key: string;
  description: string;
  category: "transactional" | "marketing";
  priority: "urgent" | "normal";
  default_channel: string;
  fallback_channels: string[];
  is_active: boolean;
  templates: TemplateRow[];
}

const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "zh", label: "中文" },
  { code: "fr", label: "FR" },
];

export default function ComunicacionesPage() {
  // v8.3 M-2 (auditoría go-live 2026-07-20): el link de abajo apuntaba a
  // /admin/config-history sin prefijo de locale -- rompía la navegación en
  // rutas no-en (ej. /zh/admin/comunicaciones). Se obtiene el locale actual
  // vía useParams(), mismo patrón que
  // src/app/[locale]/admin/comunicaciones/[orderId]/page.tsx.
  const t = useTranslations("admin.comunicaciones");
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ eventKey: string; language: string } | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftReason, setDraftReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/communication-templates");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("errors.loadFailed"));
      setEvents(json.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(eventKey: string, language: string, existing?: TemplateRow) {
    setEditing({ eventKey, language });
    setDraftSubject(existing?.subject ?? "");
    setDraftBody(existing?.body ?? "");
    setDraftReason("");
  }

  function cancelEdit() {
    setEditing(null);
    setDraftSubject("");
    setDraftBody("");
    setDraftReason("");
  }

  async function save(existing?: TemplateRow) {
    if (!editing) return;
    if (!draftBody.trim()) {
      setError(t("errors.emptyBody"));
      return;
    }
    if (existing && !draftReason.trim()) {
      setError(t("errors.reasonRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/communication-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventKey: editing.eventKey,
          language: editing.language,
          subject: draftSubject.trim() || undefined,
          body: draftBody,
          reason: draftReason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("errors.saveFailed"));
      await load();
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          !search ||
          e.event_key.toLowerCase().includes(search.toLowerCase()) ||
          e.description.toLowerCase().includes(search.toLowerCase())
      ),
    [events, search]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-brand-navy">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-brand-navy">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <input
            aria-label={t("searchAria")}
            type="text"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-brand-ice px-3 py-1.5 text-sm"
          />
          <Link
            href={`/${locale}/admin/config-history?table=communication_templates`}
            className="flex items-center gap-1 rounded-md border border-brand-navy px-3 py-1.5 text-sm text-brand-navy hover:bg-brand-ice"
          >
            <History className="h-4 w-4" />
            {t("viewHistory")}
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-state-danger bg-red-50 p-3 text-sm text-state-danger">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {filtered.map((ev) => (
          <div key={ev.event_key} className="rounded-lg border border-brand-ice bg-white p-4 shadow-elevation-1">
            <div className="mb-3 flex items-center gap-2">
              <code className="text-sm text-brand-ink">{ev.event_key}</code>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  ev.category === "transactional" ? "bg-brand-navy text-white" : "bg-brand-navy-light text-white"
                }`}
              >
                {ev.category === "transactional" ? t("categoryTransactional") : t("categoryMarketing")}
              </span>
              {ev.priority === "urgent" && (
                <span className="rounded bg-state-danger px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {t("urgent")}
                </span>
              )}
              <span className="ml-auto text-xs text-gray-400">{ev.description}</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {LANGUAGES.map(({ code, label }) => {
                const existing = ev.templates.find((t) => t.language === code);
                const isEditingThis = editing?.eventKey === ev.event_key && editing?.language === code;

                return (
                  <div key={code} className="rounded-md border border-brand-ice p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-xs font-semibold text-brand-navy">{label}</span>
                      {existing && <span className="text-[10px] text-gray-400">v{existing.version}</span>}
                      {!isEditingThis && (
                        <button
                          onClick={() => startEdit(ev.event_key, code, existing)}
                          className="ml-auto text-gray-400 hover:text-brand-wave-blue"
                          aria-label={t("editTemplateAria", { eventKey: ev.event_key, language: label })}
                        >
                          {existing ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>

                    {isEditingThis ? (
                      <div className="space-y-2">
                        <input
                          aria-label={t("form.subjectAria")}
                          type="text"
                          placeholder={t("form.subjectPlaceholder")}
                          value={draftSubject}
                          onChange={(e) => setDraftSubject(e.target.value)}
                          className="w-full rounded border border-brand-ice px-2 py-1 text-xs"
                        />
                        <textarea
                          aria-label={t("form.bodyAria")}
                          placeholder={t("form.bodyPlaceholder")}
                          value={draftBody}
                          onChange={(e) => setDraftBody(e.target.value)}
                          rows={4}
                          className="w-full rounded border border-brand-ice px-2 py-1 text-xs"
                        />
                        {existing && (
                          <input
                            aria-label={t("form.reasonAria")}
                            type="text"
                            placeholder={t("form.reasonPlaceholder")}
                            value={draftReason}
                            onChange={(e) => setDraftReason(e.target.value)}
                            className="w-full rounded border border-brand-ice px-2 py-1 text-xs"
                          />
                        )}
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            className="flex items-center gap-1 rounded border border-brand-ice px-2 py-1 text-xs"
                          >
                            <X className="h-3 w-3" />
                            {t("form.cancel")}
                          </button>
                          <button
                            onClick={() => save(existing)}
                            disabled={saving}
                            className="flex items-center gap-1 rounded bg-brand-navy px-2 py-1 text-xs text-white"
                          >
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            {t("form.save")}
                          </button>
                        </div>
                      </div>
                    ) : existing ? (
                      <p className="whitespace-pre-wrap text-xs text-brand-ink">{existing.body}</p>
                    ) : (
                      <p className="text-xs text-gray-400">{t("noTemplate")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
