"use client";

import React, { useEffect, useState } from "react";
import { Loader2, CloudRain, Plus, X, Clock, ShieldAlert } from "lucide-react";

interface WeatherException {
  id: string;
  affected_date: string;
  condition: string;
  source: "manual" | "environment_canada";
  alert_lead_time_hours: number | null;
  resolution: "reschedule_no_penalty" | "safe_abort_day_rate_discount";
  reschedule_discount_percent: number | null;
  affected_orders_note: string | null;
  notes: string | null;
  created_at: string;
}

const RESOLUTION_LABEL: Record<WeatherException["resolution"], { label: string; className: string; icon: typeof Clock }> = {
  reschedule_no_penalty: { label: "Rescheduled — no penalty", className: "text-state-success", icon: Clock },
  safe_abort_day_rate_discount: { label: "Safe abort — Day Rate + 20% dcto", className: "text-state-danger", icon: ShieldAlert },
};

export default function WeatherExceptionsPage() {
  const [items, setItems] = useState<WeatherException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<WeatherException["resolution"] | null>(null);

  const [form, setForm] = useState({
    affectedDate: "",
    condition: "",
    hasAlert: true,
    alertLeadTimeHours: "",
    affectedOrdersNote: "",
    notes: "",
  });

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const leadTime = form.hasAlert ? Number(form.alertLeadTimeHours) : null;
    if (leadTime !== null && leadTime >= 2) {
      setPreview("reschedule_no_penalty");
    } else {
      setPreview("safe_abort_day_rate_discount");
    }
  }, [form.hasAlert, form.alertLeadTimeHours]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/weather-exceptions", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setItems(data.weatherExceptions || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/weather-exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          affectedDate: form.affectedDate,
          condition: form.condition.trim(),
          alertLeadTimeHours: form.hasAlert ? Number(form.alertLeadTimeHours) : null,
          affectedOrdersNote: form.affectedOrdersNote.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to save");
        return;
      }
      setShowForm(false);
      setForm({ affectedDate: "", condition: "", hasAlert: true, alertLeadTimeHours: "", affectedOrdersNote: "", notes: "" });
      await load();
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
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">Weather Exceptions</h1>
          <p className="text-sm text-gray-500 mt-1">
            D.10 exception #10. No live Environment Canada feed configured yet — declarations are manual today.
            Resolution (reschedule vs. safe abort) is always computed, never picked freely.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
        >
          <Plus className="w-4 h-4" />
          Declare Exception
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border p-4 space-y-4 max-w-xl">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">New Weather Exception</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Affected service date</label>
              <input
                type="date"
                value={form.affectedDate}
                onChange={(e) => setForm((f) => ({ ...f, affectedDate: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm w-full"
                required
              />
            </div>
            <input
              type="text"
              value={form.condition}
              onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}
              placeholder="Condition (e.g. heavy snowfall, wind >70km/h)"
              className="border rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={form.hasAlert}
                onChange={(e) => setForm((f) => ({ ...f, hasAlert: e.target.checked }))}
              />
              We got advance warning before the crew was dispatched
            </label>
            {form.hasAlert && (
              <input
                type="number"
                min={0}
                step="0.5"
                value={form.alertLeadTimeHours}
                onChange={(e) => setForm((f) => ({ ...f, alertLeadTimeHours: e.target.value }))}
                placeholder="Hours of lead time before service"
                className="border rounded-lg px-3 py-2 text-sm w-full"
                required
              />
            )}
          </div>

          {preview && (
            <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${RESOLUTION_LABEL[preview].className} bg-gray-50`}>
              {React.createElement(RESOLUTION_LABEL[preview].icon, { className: "w-4 h-4 shrink-0" })}
              Resolution: {RESOLUTION_LABEL[preview].label}
            </div>
          )}

          <textarea
            placeholder="Affected orders / zones (free text — actual rescheduling happens separately)"
            value={form.affectedOrdersNote}
            onChange={(e) => setForm((f) => ({ ...f, affectedOrdersNote: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={2}
          />
          <textarea
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={2}
          />

          <button
            type="submit"
            disabled={saving}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Declare Exception"}
          </button>
        </form>
      )}

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <CloudRain className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">No weather exceptions declared yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border divide-y">
          {items.map((item) => {
            const style = RESOLUTION_LABEL[item.resolution];
            const Icon = style.icon;
            return (
              <div key={item.id} className="p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-brand-ink text-sm">
                    {item.affected_date} — {item.condition}
                  </p>
                  <span className={`flex items-center gap-1 text-xs font-medium ${style.className}`}>
                    <Icon className="w-3.5 h-3.5" /> {style.label}
                  </span>
                </div>
                {item.alert_lead_time_hours !== null && (
                  <p className="text-xs text-gray-400">{item.alert_lead_time_hours}h lead time</p>
                )}
                {item.affected_orders_note && <p className="text-xs text-gray-500">{item.affected_orders_note}</p>}
                {item.notes && <p className="text-xs text-gray-400">{item.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
