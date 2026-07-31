"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Truck, Plus, X, MapPin, AlertTriangle, ShieldAlert } from "lucide-react";
import { isVehicleInsuranceExpired, isVehicleInsuranceExpiringSoon } from "@/lib/vehicle-insurance";
import { toIntlLocale } from "@/lib/format";

interface Vehicle {
  id: string;
  name: string;
  plate?: string;
  is_active: boolean;
  current_lat?: number;
  current_lng?: number;
  last_location_at?: string;
  insurance_expiry_date?: string | null;
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

export default function VehiclesPage() {
  const t = useTranslations("admin.vehicles");
  const params = useParams();
  // Fix (auditoría 2026-07-30, item 1): mismo fix que backups/page.tsx --
  // locale fijo "en-CA" en vez de respetar el locale de la ruta.
  const locale = toIntlLocale((params?.locale as string) || "en");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [newInsuranceExpiry, setNewInsuranceExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingInsuranceId, setEditingInsuranceId] = useState<string | null>(null);
  const [editInsuranceValue, setEditInsuranceValue] = useState("");

  useEffect(() => {
    loadVehicles();
  }, []);

  async function loadVehicles() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/vehicles", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setVehicles(data.vehicles || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newName.trim(),
          plate: newPlate.trim() || undefined,
          insuranceExpiryDate: newInsuranceExpiry || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.createFailed"));
        return;
      }
      setNewName("");
      setNewPlate("");
      setNewInsuranceExpiry("");
      setShowForm(false);
      loadVehicles();
    } catch {
      setError(t("errors.network"));
    } finally {
      setSaving(false);
    }
  }

  async function saveInsuranceExpiry(vehicleId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ insuranceExpiryDate: editInsuranceValue || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.updateInsuranceFailed"));
        return;
      }
      setEditingInsuranceId(null);
      setEditInsuranceValue("");
      loadVehicles();
    } catch {
      setError(t("errors.network"));
    } finally {
      setSaving(false);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("addVehicle")}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">{t("newVehicle")}</h2>
            <button type="button" aria-label={t("closeFormAria")} onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              aria-label={t("vehicleNameAria")}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("vehicleNamePlaceholder")}
              className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-navy outline-none"
              required
            />
            <input
              aria-label={t("plateAria")}
              type="text"
              value={newPlate}
              onChange={(e) => setNewPlate(e.target.value)}
              placeholder={t("platePlaceholder")}
              className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-navy outline-none"
            />
            <div className="sm:col-span-2">
              <label htmlFor="new-vehicle-insurance-expiry" className="text-xs text-gray-500 block mb-1">{t("insuranceExpiryLabel")}</label>
              <input
                id="new-vehicle-insurance-expiry"
                type="date"
                value={newInsuranceExpiry}
                onChange={(e) => setNewInsuranceExpiry(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-navy outline-none w-full"
              />
            </div>
          </div>
          <button
            type="submit"
            aria-label={t("saveVehicleAria")}
            disabled={saving || !newName.trim()}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
          >
            {saving ? t("saving") : t("saveVehicle")}
          </button>
        </form>
      )}

      {vehicles.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Truck className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">{t("emptyState")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vehicles.map((v) => (
            <div key={v.id} className="bg-white rounded-xl border p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Truck className="w-5 h-5 text-brand-navy" />
                  <div>
                    <p className="font-medium text-brand-ink">{v.name}</p>
                    {v.plate && <p className="text-xs text-gray-500">{v.plate}</p>}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${v.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {v.is_active ? t("active") : t("inactive")}
                </span>
              </div>
              {v.current_lat != null && v.current_lng != null ? (
                <div className="text-sm text-gray-600 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-brand-gold" />
                  <span>
                    {v.current_lat.toFixed(5)}, {v.current_lng.toFixed(5)}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-gray-400">{t("noLocationData")}</p>
              )}
              {v.last_location_at && (
                <p className="text-xs text-gray-400">
                  {t("lastSeen", { datetime: new Date(v.last_location_at).toLocaleString(locale, { timeZone: "America/Vancouver" }) })}
                </p>
              )}

              {/* v8.3 E7 — aviso preventivo de seguro. El bloqueo REAL de
                  asignación vive en el trigger SQL (migración 047); esto es
                  solo advertencia anticipada en la UI de despacho. */}
              {editingInsuranceId === v.id ? (
                <div className="flex items-center gap-2 pt-1 border-t">
                  <input
                    aria-label={t("insuranceExpiryDateAria")}
                    type="date"
                    value={editInsuranceValue}
                    onChange={(e) => setEditInsuranceValue(e.target.value)}
                    className="border rounded-lg px-2 py-1 text-xs flex-1"
                  />
                  <button
                    onClick={() => saveInsuranceExpiry(v.id)}
                    disabled={saving}
                    className="text-xs bg-brand-navy text-white px-2 py-1 rounded-lg disabled:opacity-50"
                  >
                    {t("save")}
                  </button>
                  <button
                    onClick={() => setEditingInsuranceId(null)}
                    className="text-xs text-gray-500"
                  >
                    {t("cancel")}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between pt-1 border-t">
                  {isVehicleInsuranceExpired(v.insurance_expiry_date, todayIso()) ? (
                    <span className="flex items-center gap-1 text-xs text-state-danger font-medium">
                      <ShieldAlert className="w-3.5 h-3.5" /> {t("insuranceExpired", { date: v.insurance_expiry_date })}
                    </span>
                  ) : isVehicleInsuranceExpiringSoon(v.insurance_expiry_date, todayIso()) ? (
                    <span className="flex items-center gap-1 text-xs text-state-warning font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" /> {t("insuranceExpiringSoon", { date: v.insurance_expiry_date })}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">
                      {t("insuranceLabel", { date: v.insurance_expiry_date || t("notOnFile") })}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      setEditingInsuranceId(v.id);
                      setEditInsuranceValue(v.insurance_expiry_date || "");
                    }}
                    className="text-xs text-brand-navy font-medium"
                  >
                    {t("edit")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
