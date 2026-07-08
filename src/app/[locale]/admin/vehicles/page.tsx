"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Truck, Plus, X, MapPin } from "lucide-react";

interface Vehicle {
  id: string;
  name: string;
  plate?: string;
  is_active: boolean;
  current_lat?: number;
  current_lng?: number;
  last_location_at?: string;
}

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [saving, setSaving] = useState(false);

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
        setError(err.error || "Failed to load vehicles");
        return;
      }
      const data = await res.json();
      setVehicles(data.vehicles || []);
    } catch {
      setError("Network error");
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
        body: JSON.stringify({ name: newName.trim(), plate: newPlate.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to create vehicle");
        return;
      }
      setNewName("");
      setNewPlate("");
      setShowForm(false);
      loadVehicles();
    } catch {
      setError("Network error");
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
        <h1 className="text-2xl font-bold text-brand-ink">Vehicles</h1>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Vehicle
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
            <h2 className="font-semibold text-brand-ink">New Vehicle</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Vehicle name"
              className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-navy outline-none"
              required
            />
            <input
              type="text"
              value={newPlate}
              onChange={(e) => setNewPlate(e.target.value)}
              placeholder="License plate (optional)"
              className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-navy outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !newName.trim()}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Vehicle"}
          </button>
        </form>
      )}

      {vehicles.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Truck className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">No vehicles registered.</p>
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
                  {v.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              {v.current_lat !== undefined && v.current_lng !== undefined ? (
                <div className="text-sm text-gray-600 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-brand-gold" />
                  <span>
                    {v.current_lat.toFixed(5)}, {v.current_lng.toFixed(5)}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-gray-400">No location data</p>
              )}
              {v.last_location_at && (
                <p className="text-xs text-gray-400">
                  Last seen: {new Date(v.last_location_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
