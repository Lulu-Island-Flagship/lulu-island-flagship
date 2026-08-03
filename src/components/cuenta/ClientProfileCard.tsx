"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Check, X, Loader2 } from "lucide-react";

// Card compacta al tope de /cuenta/servicios (el destino canónico de "Sign
// In / Sign Up", ver header del home) que muestra nombre + foto del cliente
// y deja editar el nombre.
//
// Contexto (2026-08-02, pedido del usuario): "usar lo que dice en su cuenta
// de Google [...] pero no siempre están actualizados [...] como un edit".
// La migración 330 prellena profiles.full_name/avatar_url desde Google SOLO
// la primera vez (si están NULL) -- este componente es el "edit" que permite
// corregirlo. avatar_url se muestra de solo lectura (viene de Google; subir
// una foto propia es una superficie distinta -- almacenamiento de
// archivos -- fuera de alcance aquí).
//
// Auto-contenido a propósito (fetch propio, sin props) para no tocar el
// estado ya grande de MisServiciosClient.tsx -- se monta como un bloque
// independiente arriba del título existente.
export function ClientProfileCard() {
  const t = useTranslations("cuenta.profile");
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Distingue "Google ya lo prellenó y el cliente nunca lo tocó" (se
  // muestra el aviso de que puede corregirlo) de "el cliente ya lo editó o
  // lo escribió a mano" (aviso ya no aplica, sería ruido).
  const [wasPrefilled, setWasPrefilled] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/client/profile", { credentials: "include" });
      if (!res.ok) return; // 401: needsAuth ya lo maneja el padre (MisServiciosClient) -- esta card simplemente no se muestra sin sesión.
      const data = await res.json();
      setFullName(data.fullName);
      setAvatarUrl(data.avatarUrl);
      setNameInput(data.fullName || "");
      setWasPrefilled(Boolean(data.fullName));
    } catch {
      // Silencioso a propósito: esto es un detalle secundario de la
      // pantalla, no vale la pena un StatusBanner de error por encima del
      // contenido principal (los servicios del cliente) si esto falla.
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/client/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fullName: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || t("saveFailed"));
        return;
      }
      const data = await res.json();
      setFullName(data.fullName);
      setEditing(false);
      setWasPrefilled(false);
    } catch {
      setError(t("networkError"));
    } finally {
      setSaving(false);
    }
  }

  if (loading || (!fullName && !avatarUrl && !editing)) {
    // Sin nombre/foto (ej. cliente que se registró por teléfono, sin
    // Google) y sin haber pedido editar todavía: no mostrar una card vacía
    // que no aporta nada -- solo el botón de editar, discreto.
    if (loading) return null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-xs text-brand-wave-blue hover:text-brand-navy underline mb-2"
      >
        <Pencil className="w-3 h-3" />
        {t("editLabel")}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-white rounded-xl border p-3 mb-2">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto externa de Google, no un asset local optimizable por next/image sin configurar remotePatterns.
        <img src={avatarUrl} alt={t("avatarAlt")} className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-brand-ice shrink-0" aria-hidden="true" />
      )}

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t("namePlaceholder")}
              aria-label={t("editLabel")}
              className="flex-1 min-w-0 px-2 py-1 rounded border border-gray-300 text-sm"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving || !nameInput.trim()}
              aria-label={t("save")}
              className="text-state-success disabled:opacity-40 shrink-0"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setNameInput(fullName || "");
                setError("");
              }}
              aria-label={t("cancel")}
              className="text-gray-400 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:text-brand-navy truncate"
          >
            <span className="truncate">{fullName}</span>
            <Pencil className="w-3 h-3 text-gray-400 shrink-0" />
          </button>
        )}
        {wasPrefilled && !editing && (
          <p className="text-[11px] text-gray-400 mt-0.5">{t("prefilledFromGoogleNotice")}</p>
        )}
        {error && <p className="text-xs text-state-danger mt-0.5">{error}</p>}
      </div>
    </div>
  );
}
