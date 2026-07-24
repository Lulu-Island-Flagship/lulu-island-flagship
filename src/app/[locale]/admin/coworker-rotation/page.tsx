"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Users, AlertTriangle, CheckCircle2, Plus } from "lucide-react";

interface RotationStatus {
  employeeId: string;
  distinctCoworkerIds: string[];
  distinctCount: number;
  compliant: boolean;
}

interface Violation {
  employeeAId: string;
  employeeBId: string;
  reason: string;
  orderIds: string[];
}

interface ExceptionRow {
  id: string;
  employee_a_id: string;
  employee_b_id: string;
  reason: string;
  is_active: boolean;
}

function thisMonthStr(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function CoworkerRotationPage() {
  const [month, setMonth] = useState(thisMonthStr());
  const [rotationStatus, setRotationStatus] = useState<RotationStatus[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employeeAId: "", employeeBId: "", reason: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/coworker-rotation?month=${month}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setRotationStatus(data.rotationStatus || []);
      setViolations(data.violations || []);
      setExceptions(data.exceptions || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function addException(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/coworker-rotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "add_exception", ...form }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to save");
        return;
      }
      setShowForm(false);
      setForm({ employeeAId: "", employeeBId: "", reason: "" });
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  const nonCompliant = rotationStatus.filter((r) => !r.compliant);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">Coworker Rotation</h1>
          <p className="text-sm text-gray-500 mt-1">
            Minimum 3 distinct coworkers per month (E8.14). Read-only analysis over assignments — does not touch
            the dispatch engine.
          </p>
        </div>
        <input
          type="month"
          aria-label="Mes de análisis de rotación"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        <>
          {violations.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-red-800 flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4" /> &quot;Never together&quot; exceptions violated this month
              </h2>
              {violations.map((v, i) => (
                <p key={i} className="text-xs text-red-700">
                  {v.employeeAId} + {v.employeeBId} — {v.reason} ({v.orderIds.length} order(s))
                </p>
              ))}
            </div>
          )}

          <div>
            <h2 className="font-semibold text-brand-ink mb-2 flex items-center gap-2">
              <Users className="w-4 h-4 text-brand-wave-blue" /> Rotation status ({nonCompliant.length} below minimum)
            </h2>
            <div className="bg-white rounded-xl border divide-y">
              {rotationStatus.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">No assignments recorded for {month}.</p>
              ) : (
                rotationStatus.map((r) => (
                  <div key={r.employeeId} className="p-3 flex items-center justify-between text-sm">
                    <span className="text-brand-ink">{r.employeeId}</span>
                    <span className={`flex items-center gap-1 text-xs font-medium ${r.compliant ? "text-state-success" : "text-state-danger"}`}>
                      {r.compliant ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      {r.distinctCount} distinct coworkers
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-brand-ink">&quot;Never together&quot; exceptions</h2>
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-1.5 text-sm text-brand-navy hover:underline"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>

            {showForm && (
              <form onSubmit={addException} className="bg-white rounded-xl border p-4 space-y-3 mb-3">
                <input
                  type="text"
                  aria-label="ID del empleado A"
                  placeholder="Employee A ID"
                  value={form.employeeAId}
                  onChange={(e) => setForm((f) => ({ ...f, employeeAId: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  required
                />
                <input
                  type="text"
                  aria-label="ID del empleado B"
                  placeholder="Employee B ID"
                  value={form.employeeBId}
                  onChange={(e) => setForm((f) => ({ ...f, employeeBId: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  required
                />
                <input
                  type="text"
                  aria-label="Razón de la excepción"
                  placeholder="Reason"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  required
                />
                <div className="flex gap-2">
                  <button aria-label="Guardar excepción de rotación" type="submit" disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-500 px-4 py-2">
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="bg-white rounded-xl border divide-y">
              {exceptions.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">No exceptions documented.</p>
              ) : (
                exceptions.map((exc) => (
                  <div key={exc.id} className="p-3 text-sm">
                    <p className="text-brand-ink">{exc.employee_a_id} + {exc.employee_b_id}</p>
                    <p className="text-xs text-gray-500">{exc.reason}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
