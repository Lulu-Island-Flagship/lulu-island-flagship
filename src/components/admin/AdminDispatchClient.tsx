"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  Languages as LanguagesIcon,
  ClockAlert,
  User,
  Pencil,
  Info,
} from "lucide-react";

interface OrderAssignment {
  assignmentId: string;
  employeeId: string;
  name: string;
  role: string | null;
  languages: string[];
  trustLevel: string | null;
  isActive: boolean | null;
  status: string;
  lockedByAdmin: boolean;
}

interface OrderSummary {
  orderId: string;
  serviceTime: string;
  status: string;
  serviceType: string;
  squareFeet: number;
  zone: string | null;
  hheHours: number;
  minTeams: number;
  maxTeams: number;
  clientLanguages: string[];
  languageMatch: "match" | "no_match" | "unassigned";
  assignments: OrderAssignment[];
}

interface EmployeeWorkday {
  employeeId: string;
  name: string;
  ordersCount: number;
  totalDayMinutes: number;
  status: "ok" | "overtime_needs_approval" | "blocked";
  reasons: string[];
}

interface DispatchResponse {
  date: string;
  scheduled: boolean;
  transitMinutesIsPlaceholder?: boolean;
  orders: OrderSummary[];
  employeeWorkdays: EmployeeWorkday[];
}

interface EmployeeOption {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
  languages: string[];
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

const LANGUAGE_BADGE: Record<OrderSummary["languageMatch"], { label: string; className: string }> = {
  match: { label: "Language match", className: "bg-state-success/10 text-state-success" },
  no_match: { label: "No language match", className: "bg-state-danger/10 text-state-danger" },
  unassigned: { label: "Unassigned", className: "bg-gray-100 text-gray-500" },
};

const WORKDAY_BADGE: Record<EmployeeWorkday["status"], { label: string; className: string }> = {
  ok: { label: "OK", className: "text-state-success" },
  overtime_needs_approval: { label: ">8h — needs approval", className: "text-state-warning" },
  blocked: { label: ">10h — blocked", className: "text-state-danger" },
};

export default function AdminDispatchClient() {
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<DispatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [editingOrder, setEditingOrder] = useState<OrderSummary | null>(null);

  const loadDispatch = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/dispatch?date=${date}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load dispatch data");
        return;
      }
      setData(await res.json());
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    loadDispatch();
  }, [loadDispatch]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/empleados", { credentials: "include" });
        if (res.ok) {
          const json = await res.json();
          setEmployees(json.employees || []);
        }
      } catch {
        // El picker de empleados es secundario -- si falla, el resto de la
        // pantalla sigue siendo útil de solo lectura.
      }
    })();
  }, []);

  const formatMinutes = (min: number) => `${(min / 60).toFixed(1)}h`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-brand-ink">Dispatch review</h1>
        <input
          type="date"
          aria-label="Fecha del reparto a revisar"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm"
        />
      </div>

      <div className="flex items-start gap-2 bg-brand-navy/5 border border-brand-navy/10 rounded-lg p-3 text-xs text-gray-600">
        <Info className="w-4 h-4 text-brand-wave-blue flex-shrink-0 mt-0.5" />
        <p>
          Transit time isn&apos;t wired to live traffic data yet — workday totals use a fixed 30 min/order
          placeholder (same one the scheduler uses internally), not a real ETA. Manual assignments you make
          here are locked and will survive the 5:30 PM automatic publish.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      ) : !data || data.orders.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <p className="text-gray-500">No services scheduled for {date}.</p>
        </div>
      ) : (
        <>
          {!data.scheduled && (
            <div className="bg-state-warning/10 border border-state-warning/20 rounded-lg p-3 text-xs text-state-warning">
              No assignments exist yet for this date — the scheduler proposes at 4:30 PM and publishes at
              5:30 PM the day before. You can assign manually now; it will lock and won&apos;t be overwritten.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {data.orders.map((order) => {
                const badge = LANGUAGE_BADGE[order.languageMatch];
                return (
                  <div key={order.orderId} className="bg-white rounded-xl border p-4">
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-brand-ink">{order.serviceTime}</span>
                          <span className="text-sm text-gray-500 capitalize">{order.serviceType}</span>
                          <span className="text-sm text-gray-400">{order.squareFeet} sqft</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {order.zone ?? "Zone n/a"} · N {order.minTeams}-{order.maxTeams} · HHE{" "}
                          {order.hheHours.toFixed(1)}h
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${badge.className}`}>
                          <LanguagesIcon className="w-3 h-3" />
                          {badge.label}
                        </span>
                        <button
                          onClick={() => setEditingOrder(order)}
                          className="flex items-center gap-1 text-xs text-brand-wave-blue hover:text-brand-navy"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {order.assignments.length === 0 ? (
                        <span className="text-xs text-gray-400">No one assigned</span>
                      ) : (
                        order.assignments.map((a) => (
                          <span
                            key={a.assignmentId}
                            className={`text-xs px-2 py-1 rounded-lg border flex items-center gap-1.5 ${
                              a.lockedByAdmin
                                ? "border-brand-gold/40 bg-brand-gold/5"
                                : "border-gray-200 bg-gray-50"
                            }`}
                          >
                            <User className="w-3 h-3 text-gray-400" />
                            {a.name}
                            {a.role === "supervisor" && (
                              <span className="text-brand-wave-blue">· lead</span>
                            )}
                            {a.lockedByAdmin && <span className="text-brand-gold-dark">· locked</span>}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-brand-ink">Workday summary</h2>
              {data.employeeWorkdays.length === 0 ? (
                <p className="text-xs text-gray-400">No one assigned yet.</p>
              ) : (
                data.employeeWorkdays.map((w) => {
                  const badge = WORKDAY_BADGE[w.status];
                  return (
                    <div key={w.employeeId} className="bg-white rounded-xl border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{w.name}</span>
                        <span className={`text-xs font-medium flex items-center gap-1 ${badge.className}`}>
                          {w.status !== "ok" && <ClockAlert className="w-3.5 h-3.5" />}
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {w.ordersCount} order(s) · {formatMinutes(w.totalDayMinutes)} total
                      </p>
                      {w.reasons.length > 0 && (
                        <p className="text-[11px] text-gray-400 mt-1">{w.reasons.join(" · ")}</p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {editingOrder && (
        <EditAssignmentModal
          order={editingOrder}
          employees={employees}
          onClose={() => setEditingOrder(null)}
          onSaved={() => {
            setEditingOrder(null);
            loadDispatch();
          }}
        />
      )}
    </div>
  );
}

function EditAssignmentModal({
  order,
  employees,
  onClose,
  onSaved,
}: {
  order: OrderSummary;
  employees: EmployeeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(order.assignments.map((a) => a.employeeId));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (selected.length === 0) {
      setSaveError("Select at least one employee");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/admin/dispatch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId, employeeIds: selected, notes: notes || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const activeEmployees = employees.filter((e) => e.is_active);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-semibold text-brand-ink">
            {order.serviceTime} — {order.serviceType}
          </h2>
          <p className="text-xs text-gray-500">
            Requires {order.minTeams}-{order.maxTeams} team member(s). Client language(s):{" "}
            {order.clientLanguages.join(", ")}
          </p>
        </div>

        <div className="space-y-1 max-h-64 overflow-y-auto border rounded-lg p-2">
          {activeEmployees.map((emp) => (
            <label key={emp.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                aria-label={`Asignar a ${emp.name}`}
                checked={selected.includes(emp.id)}
                onChange={() => toggle(emp.id)}
                className="w-4 h-4 accent-brand-gold"
              />
              <span className="text-sm flex-1">{emp.name}</span>
              <span className="text-xs text-gray-400">{emp.role}</span>
              {order.clientLanguages.some((l) => emp.languages?.includes(l)) && (
                <LanguagesIcon className="w-3.5 h-3.5 text-state-success" />
              )}
            </label>
          ))}
        </div>

        <textarea
          rows={2}
          aria-label="Notas de la asignación (opcional)"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full text-sm border rounded-lg px-3 py-2"
        />

        {saveError && <p className="text-xs text-state-danger">{saveError}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            aria-label={saving ? "Guardando asignación" : "Guardar y bloquear asignación"}
            className="px-4 py-2 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save & lock"}
          </button>
        </div>
      </div>
    </div>
  );
}
