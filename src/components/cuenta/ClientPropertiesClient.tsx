"use client";

import React, { useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Home,
  Trash2,
  Save,
  X,
  Edit2,
  MapPin,
} from "lucide-react";
import { ACTIVE_ZONES } from "@/lib/pricing";
import type { ClientProperty } from "@/types";

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
  const [properties, setProperties] = useState<ClientProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<PropertyFormData>(emptyForm);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [postalError, setPostalError] = useState("");

  useEffect(() => {
    loadProperties();
  }, []);

  async function loadProperties() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/client/properties", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load properties");
        return;
      }
      const data = await res.json();
      setProperties((data.properties || []) as ClientProperty[]);
    } catch {
      setError("Network error");
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
      setPostalError(isValidCanadianPostal(upper) ? "" : "Invalid format. Use: V6X 1A1");
    } else {
      setPostalError("");
    }
  }

  function validateForm(): string | null {
    if (!form.address.trim()) return "Address is required";
    if (!form.zone) return "Zone is required";
    if (form.postalCode && !isValidCanadianPostal(form.postalCode)) return "Invalid postal code";
    if (form.squareFeet && (Number.isNaN(Number(form.squareFeet)) || Number(form.squareFeet) <= 0)) {
      return "Square feet must be a positive number";
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
        setError(err.error || "Failed to save property");
        return;
      }

      resetForm();
      await loadProperties();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProperty(id: string) {
    if (!window.confirm("Are you sure you want to remove this property?")) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/client/properties?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to delete property");
        return;
      }
      await loadProperties();
    } catch {
      setError("Network error");
    } finally {
      setDeletingId(null);
    }
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
        <h1 className="text-3xl font-bold text-brand-ink mb-2">My Properties</h1>
        <p className="text-gray-600">Save multiple addresses to speed up future bookings.</p>
        <a href="../servicios" className="inline-block mt-2 text-xs text-brand-wave-blue hover:text-brand-navy underline">
          View my service history
        </a>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-brand-ink flex items-center gap-2">
            <Home className="w-5 h-5 text-brand-wave-blue" />
            {isEditing ? "Edit property" : "Add a property"}
          </h2>
          {isEditing && (
            <button aria-label="Cancelar edición de propiedad" onClick={resetForm} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="property-nickname-input" className="text-sm font-medium text-gray-700">Nickname (optional)</label>
              <input
                id="property-nickname-input"
                type="text"
                value={form.nickname}
                onChange={(e) => setForm((prev) => ({ ...prev, nickname: e.target.value }))}
                placeholder="e.g. Home, Office"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="property-square-feet-input" className="text-sm font-medium text-gray-700">Square feet (optional)</label>
              <input
                id="property-square-feet-input"
                type="number"
                value={form.squareFeet}
                onChange={(e) => setForm((prev) => ({ ...prev, squareFeet: e.target.value }))}
                placeholder="e.g. 1200"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="property-address-input" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <MapPin className="w-4 h-4" />
              Street address
            </label>
            <input
              id="property-address-input"
              type="text"
              value={form.address}
              onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
              placeholder="e.g. 123 Main Street, Richmond"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Zone</label>
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
            <label htmlFor="property-postal-code-input" className="text-sm font-medium text-gray-700">Postal code</label>
            <input
              id="property-postal-code-input"
              type="text"
              value={form.postalCode}
              onChange={(e) => handlePostalChange(e.target.value)}
              placeholder="e.g. V7E 2A1"
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
                Cancel
              </button>
            )}
            <button
              aria-label={isEditing ? "Guardar cambios de la propiedad" : "Agregar propiedad"}
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <Save className="w-4 h-4" />
              {isEditing ? "Save changes" : "Add property"}
            </button>
          </div>
        </form>
      </div>

      {properties.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Home className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">No saved properties yet.</p>
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
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteProperty(property.id)}
                    disabled={deletingId === property.id}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-50"
                    title="Delete"
                  >
                    {deletingId === property.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
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
