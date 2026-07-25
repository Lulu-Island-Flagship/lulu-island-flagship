"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Home,
  Trash2,
  Save,
  X,
  Edit2,
  MapPin,
} from "lucide-react";
import { ACTIVE_ZONES } from "@/lib/pricing";
import type { ClientProperty } from "@/types";
import { StatusBanner } from "./StatusBanner";
import { supabase } from "@/lib/supabase";
import { AuthModal } from "@/components/cotizador/AuthModal";

function isValidCanadianPostal(code: string): boolean {
  const normalized = code.replace(/\s/g, "").toUpperCase();
  return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(normalized);
}

interface PropertyFormData {
  nickname: string;
  address: string;
  zone: string;
  postalCode: string;
  squareFeet: string;
}

const emptyForm: PropertyFormData = {
  nickname: "",
  address: "",
  zone: ACTIVE_ZONES[0]?.name || "Richmond",
  postalCode: "",
  squareFeet: "",
};

export default function ClientPropertiesClient() {
  const t = useTranslations("cuenta.propiedades");
  const tCommon = useTranslations("cuenta.common");
  const [properties, setProperties] = useState<ClientProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<PropertyFormData>(emptyForm);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [postalError, setPostalError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  // Fix (auditoría externa 2026-07-24): mismo patrón ya aplicado en
  // MisServiciosClient.tsx -- este componente no comprobaba sesión antes de
  // pedir datos, así que una sesión expirada entre el chequeo del layout
  // padre (cuenta/layout.tsx) y este fetch se mostraba como un StatusBanner
  // de error genérico en vez de pedir login de nuevo.
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    loadProperties();
  }, []);

  async function loadProperties() {
    setLoading(true);
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setNeedsAuth(true);
        setLoading(false);
        return;
      }
      setNeedsAuth(false);

      const res = await fetch("/api/client/properties", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) {
          setNeedsAuth(true);
          return;
        }
        const err = await res.json();
        setError(err.error || t("loadFailed"));
        return;
      }
      const data = await res.json();
      setProperties((data.properties || []) as ClientProperty[]);
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm(emptyForm);
    setIsEditing(false);
    setEditingId(null);
    setPostalError("");
  }

  function startEdit(property: ClientProperty) {
    setForm({
      nickname: property.nickname || "",
      address: property.address,
      zone: property.zone,
      postalCode: property.postalCode || "",
      squareFeet: property.squareFeet ? String(property.squareFeet) : "",
    });
    setIsEditing(true);
    setEditingId(property.id);
    setPostalError("");
  }

  function handlePostalChange(value: string) {
    const upper = value.toUpperCase();
    setForm((prev) => ({ ...prev, postalCode: upper }));
    if (upper.length >= 6) {
      setPostalError(isValidCanadianPostal(upper) ? "" : t("postalInvalid"));
    } else {
      setPostalError("");
    }
  }

  function validateForm(): string | null {
    if (!form.address.trim()) return t("addressRequired");
    if (!form.zone) return t("zoneRequired");
    if (form.postalCode && !isValidCanadianPostal(form.postalCode)) return t("postalCodeInvalid");
    if (form.squareFeet && (Number.isNaN(Number(form.squareFeet)) || Number(form.squareFeet) <= 0)) {
      return t("squareFeetInvalid");
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    const payload: Record<string, unknown> = {
      nickname: form.nickname.trim() || undefined,
      address: form.address.trim(),
      zone: form.zone,
      postalCode: form.postalCode.trim().toUpperCase() || undefined,
      squareFeet: form.squareFeet ? Number(form.squareFeet) : undefined,
    };

    try {
      const res = await fetch("/api/client/properties", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(isEditing ? { ...payload, id: editingId } : payload),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("saveFailed"));
        return;
      }

      resetForm();
      await loadProperties();
      setSuccessMessage(t("savedSuccess"));
    } catch {
      setError(t("networkError"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteProperty(id: string) {
    if (!window.confirm(t("confirmDelete"))) return;

    setDeletingId(id);
    setSuccessMessage("");
    try {
      const res = await fetch(`/api/client/properties?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("deleteFailed"));
        return;
      }
      await loadProperties();
      setSuccessMessage(t("deletedSuccess"));
    } catch {
      setError(t("networkError"));
    } finally {
      setDeletingId(null);
    }
  }

  if (needsAuth) {
    return (
      <AuthModal
        onClose={() => {
          const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en";
          const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
          window.location.href = `/${safeLocale}`;
        }}
        onSuccess={() => loadProperties()}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-brand-ink mb-2">{t("title")}</h1>
        <p className="text-gray-600">{t("subtitle")}</p>
        <a href="../servicios" className="inline-block mt-2 text-xs text-brand-wave-blue hover:text-brand-navy underline">
          {t("viewServiceHistory")}
        </a>
      </div>

      <StatusBanner
        variant="error"
        message={error}
        onRetry={loadProperties}
        onDismiss={() => setError("")}
        retryLabel={tCommon("retry")}
        dismissLabel={tCommon("dismiss")}
      />
      <StatusBanner
        variant="success"
        message={successMessage}
        onDismiss={() => setSuccessMessage("")}
        autoDismissMs={4000}
        dismissLabel={tCommon("dismiss")}
      />

      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-brand-ink flex items-center gap-2">
            <Home className="w-5 h-5 text-brand-wave-blue" />
            {isEditing ? t("editProperty") : t("addProperty")}
          </h2>
          {isEditing && (
            <button aria-label={t("cancelEditAriaLabel")} onClick={resetForm} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="property-nickname-input" className="text-sm font-medium text-gray-700">{t("nicknameLabel")}</label>
              <input
                id="property-nickname-input"
                type="text"
                value={form.nickname}
                onChange={(e) => setForm((prev) => ({ ...prev, nickname: e.target.value }))}
                placeholder={t("nicknamePlaceholder")}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="property-square-feet-input" className="text-sm font-medium text-gray-700">{t("squareFeetLabel")}</label>
              <input
                id="property-square-feet-input"
                type="number"
                value={form.squareFeet}
                onChange={(e) => setForm((prev) => ({ ...prev, squareFeet: e.target.value }))}
                placeholder={t("squareFeetPlaceholder")}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="property-address-input" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <MapPin className="w-4 h-4" />
              {t("streetAddressLabel")}
            </label>
            <input
              id="property-address-input"
              type="text"
              value={form.address}
              onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
              placeholder={t("streetAddressPlaceholder")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">{t("zoneLabel")}</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ACTIVE_ZONES.map((z) => (
                <button
                  key={z.name}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, zone: z.name }))}
                  className={`p-3 rounded-lg border text-left text-sm transition-all ${
                    form.zone === z.name
                      ? "border-brand-gold bg-brand-gold/10 font-medium"
                      : "border-gray-200 hover:border-brand-wave-blue"
                  }`}
                >
                  {z.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="property-postal-code-input" className="text-sm font-medium text-gray-700">{t("postalCodeLabel")}</label>
            <input
              id="property-postal-code-input"
              type="text"
              value={form.postalCode}
              onChange={(e) => handlePostalChange(e.target.value)}
              placeholder={t("postalCodePlaceholder")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold uppercase"
            />
            {postalError && <p className="text-xs text-state-danger">{postalError}</p>}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            {isEditing && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t("cancel")}
              </button>
            )}
            <button
              aria-label={isEditing ? t("saveChangesAriaLabel") : t("addPropertyAriaLabel")}
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <Save className="w-4 h-4" />
              {isEditing ? t("saveChanges") : t("addProperty")}
            </button>
          </div>
        </form>
      </div>

      {properties.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Home className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("noProperties")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="divide-y">
            {properties.map((property) => (
              <div key={property.id} className="p-4 flex items-start justify-between gap-4 hover:bg-gray-50">
                <div>
                  <div className="font-medium text-brand-ink">
                    {property.nickname || property.address}
                  </div>
                  {property.nickname && <div className="text-sm text-gray-600">{property.address}</div>}
                  <div className="text-xs text-gray-500 mt-1">
                    {property.zone}
                    {property.postalCode && ` · ${property.postalCode}`}
                    {property.squareFeet && ` · ${property.squareFeet} ft²`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(property)}
                    className="text-gray-400 hover:text-brand-navy"
                    title={t("edit")}
                    aria-label={t("edit")}
                  >
                    <Edit2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => deleteProperty(property.id)}
                    disabled={deletingId === property.id}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-50"
                    title={t("delete")}
                    aria-label={t("delete")}
                  >
                    {deletingId === property.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
