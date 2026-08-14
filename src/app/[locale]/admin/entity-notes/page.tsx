"use client";

import React, { useEffect, useState } from "react";
import { Loader2, StickyNote, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

type EntityType = "employee" | "client_property" | "client_profile" | "vehicle";

interface Note {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  note: string;
  suggest_context: string[];
  created_at: string;
}

interface SimpleOption {
  id: string;
  label: string;
}

const CONTEXT_OPTIONS = ["dispatch", "quote", "checkin", "servicio"];

export default function EntityNotesPage() {
  const t = useTranslations("admin.entityNotes");
  const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
    employee: t("entityType.employee"),
    client_property: t("entityType.clientProperty"),
    client_profile: t("entityType.clientProfile"),
    vehicle: t("entityType.vehicle"),
  };
  const [entityType, setEntityType] = useState<EntityType>("employee");
  const [options, setOptions] = useState<SimpleOption[]>([]);
  const [entityId, setEntityId] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [error, setError] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newContexts, setNewContexts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Fix (auditoría 2026-08-01): borrar una nota se disparaba directo desde el
  // onClick del ícono de basura, sin ninguna confirmación (ni siquiera
  // window.confirm). Se agrega ConfirmActionModal (mismo patrón que el resto
  // del admin) para evitar borrados accidentales de conocimiento operativo
  // que puede no ser fácil de reconstruir (p.ej. "no emparejar con Pedro").
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  useEffect(() => {
    if (entityId) loadNotes();
    else setNotes([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  async function loadOptions() {
    setLoadingOptions(true);
    setEntityId("");
    try {
      const table = entityType === "employee" ? "employees" : entityType === "client_property" ? "client_properties" : entityType === "vehicle" ? "vehicles" : "client_profiles";
      const res = await fetch(`/api/admin/entity-options?table=${table}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setOptions(data.options || []);
      }
    } finally {
      setLoadingOptions(false);
    }
  }

  async function loadNotes() {
    setLoadingNotes(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/entity-notes?entityType=${entityType}&entityId=${entityId}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorLoading"));
        return;
      }
      const data = await res.json();
      setNotes(
        (data.notes || []).map((n: { entityType: string; entityId: string; suggestContext: string[]; note: string; id: string }) => ({
          id: n.id,
          entity_type: n.entityType,
          entity_id: n.entityId,
          note: n.note,
          suggest_context: n.suggestContext,
          created_at: "",
        }))
      );
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoadingNotes(false);
    }
  }

  async function addNote() {
    if (!newNote.trim() || !entityId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/entity-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entityType, entityId, note: newNote.trim(), suggestContext: newContexts }),
      });
      if (res.ok) {
        setNewNote("");
        setNewContexts([]);
        await loadNotes();
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(id: string) {
    setError("");
    const res = await fetch(`/api/admin/entity-notes?id=${id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Se lanza el error para que ConfirmActionModal lo muestre dentro del
      // modal y lo mantenga abierto (permite reintentar) en vez de tragarlo.
      throw new Error(err.error || t("errorDeleting"));
    }
    await loadNotes();
  }

  function toggleContext(ctx: string) {
    setNewContexts((prev) => (prev.includes(ctx) ? prev.filter((c) => c !== ctx) : [...prev, ctx]));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t("entityTypeLabel")}</label>
            <select
              aria-label={t("entityTypeLabel")}
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
              className="border rounded-lg px-3 py-2 text-sm w-full"
            >
              {Object.entries(ENTITY_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{ENTITY_TYPE_LABEL[entityType]}</label>
            <select
              aria-label={t("selectEntity")}
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              disabled={loadingOptions}
              className="border rounded-lg px-3 py-2 text-sm w-full"
            >
              <option value="">{t("selectPlaceholder")}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

        {entityId && (
          <>
            <div className="space-y-2 border-t pt-4">
              <textarea
                aria-label={t("newNote")}
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder={t("newNotePlaceholder")}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                rows={2}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400">{t("surfaceIn")}</span>
                {CONTEXT_OPTIONS.map((ctx) => (
                  <button
                    key={ctx}
                    type="button"
                    onClick={() => toggleContext(ctx)}
                    className={`text-xs px-2 py-1 rounded-full border ${
                      newContexts.includes(ctx) ? "bg-brand-navy text-white border-brand-navy" : "text-gray-500 border-gray-200"
                    }`}
                  >
                    {ctx}
                  </button>
                ))}
              </div>
              <button
                onClick={addNote}
                disabled={saving || !newNote.trim()}
                className="inline-flex items-center gap-2 bg-brand-navy text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> {t("addNote")}
              </button>
            </div>

            <div className="border-t pt-4">
              {loadingNotes ? (
                <Loader2 className="w-5 h-5 animate-spin text-brand-gold-dark" />
              ) : notes.length === 0 ? (
                <p className="text-sm text-gray-400 flex items-center gap-2">
                  <StickyNote className="w-4 h-4" /> {t("noNotes")}
                </p>
              ) : (
                <div className="space-y-2">
                  {notes.map((n) => (
                    <div key={n.id} className="flex items-start justify-between gap-3 bg-gray-50 rounded-lg p-3">
                      <div>
                        <p className="text-sm text-brand-ink">{n.note}</p>
                        {n.suggest_context.length > 0 && (
                          <p className="text-xs text-gray-400 mt-1">{t("shownIn", { contexts: n.suggest_context.join(", ") })}</p>
                        )}
                      </div>
                      <button onClick={() => setPendingDeleteId(n.id)} aria-label={t("deleteNote")} className="text-gray-300 hover:text-state-danger shrink-0">
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {pendingDeleteId && (
        <ConfirmActionModal
          title={t("deleteNote")}
          message={t("confirmDeleteMessage")}
          danger
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={async () => {
            await deleteNote(pendingDeleteId);
            setPendingDeleteId(null);
          }}
        />
      )}
    </div>
  );
}
