"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  AlertCircle,
  Languages as LanguagesIcon,
  ClockAlert,
  User,
  Pencil,
  Info,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useFocusTrap } from "@/lib/useFocusTrap";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";
import { getVancouverTodayString } from "@/lib/date-utils";

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
  return getVancouverTodayString();
}

const LANGUAGE_BADGE: Record<OrderSummary["languageMatch"], { className: string }> = {
  match: { className: "bg-state-success/10 text-state-success" },
  no_match: { className: "bg-state-danger/10 text-state-danger" },
  unassigned: { className: "bg-gray-100 text-gray-500" },
};

const WORKDAY_BADGE: Record<EmployeeWorkday["status"], { className: string }> = {
  ok: { className: "text-state-success" },
  overtime_needs_approval: { className: "text-state-warning" },
  blocked: { className: "text-state-danger" },
};

export default function AdminDispatchClient() {
  const t = useTranslations("admin.dispatch");
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<DispatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [editingOrder, setEditingOrder] = useState<OrderSummary | null>(null);
  const [realtimeNotice, setRealtimeNotice] = useState<string | null>(null);

  // El modal de edición se cierra desde el callback de realtime, que se
  // suscribe una sola vez (ver useEffect de abajo) -- necesita un ref para
  // no quedarse con un closure viejo de `editingOrder`.
  const editingOrderRef = useRef<OrderSummary | null>(null);
  useEffect(() => {
    editingOrderRef.current = editingOrder;
  }, [editingOrder]);

  const loadDispatch = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/dispatch?date=${date}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("loadError"));
        return;
      }
      setData(await res.json());
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }, [date, t]);

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

  // Bug auditoría (colisión de concurrencia en dispatch): el tablero no
  // tenía suscripción en tiempo real -- si dos operadores lo tenían abierto
  // y asignaban empleados distintos a la misma orden, la última petición
  // pisaba la anterior sin avisar a nadie. Se suscribe a `assignments`
  // (la tabla que escribe POST /api/admin/dispatch) para refrescar el
  // tablero automáticamente y avisar si la orden que este operador tenía
  // abierta en el modal de edición cambió por otra persona.
  useEffect(() => {
    const channel = supabase
      .channel("admin-dispatch-assignments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assignments" },
        (payload) => {
          const changedOrderId =
            (payload.new as { order_id?: string } | null)?.order_id ??
            (payload.old as { order_id?: string } | null)?.order_id ??
            null;

          if (changedOrderId && editingOrderRef.current?.orderId === changedOrderId) {
            // La orden que este operador estaba editando cambió por otra
            // persona mientras tenía el modal abierto: se cierra para no
            // arriesgar que su "Save" pise el cambio ajeno sin saberlo, y
            // se avisa explícitamente por qué se cerró.
            setEditingOrder(null);
            setRealtimeNotice(t("realtimeConflictClosed"));
          } else {
            setRealtimeNotice(t("realtimeUpdated"));
          }

          loadDispatch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDispatch]);

  const formatMinutes = (min: number) => `${(min / 60).toFixed(1)}h`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <input
          type="date"
          aria-label={t("dateAriaLabel")}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm"
        />
      </div>

      <div className="flex items-start gap-2 bg-brand-navy/5 border border-brand-navy/10 rounded-lg p-3 text-xs text-gray-600">
        <Info className="w-4 h-4 text-brand-wave-blue flex-shrink-0 mt-0.5" />
        <p>
          {t("transitNotice")}
        </p>
      </div>

      {realtimeNotice && (
        <div className="flex items-start gap-2 bg-brand-gold/10 border border-brand-gold/30 rounded-lg p-3 text-xs text-brand-ink">
          <RefreshCw className="w-4 h-4 text-brand-gold-dark flex-shrink-0 mt-0.5" />
          <p className="flex-1">{realtimeNotice}</p>
          <button
            type="button"
            onClick={() => setRealtimeNotice(null)}
            aria-label="Dismiss"
            className="text-gray-400 hover:text-gray-600 text-sm leading-none px-1"
          >
            ×
          </button>
        </div>
      )}

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
          <p className="text-gray-500">{t("emptyForDate", { date })}</p>
        </div>
      ) : (
        <>
          {!data.scheduled && (
            <div className="bg-state-warning/10 border border-state-warning/20 rounded-lg p-3 text-xs text-state-warning">
              {t("noAssignmentsYet")}
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
                          {order.zone ?? t("zoneNA")} · N {order.minTeams}-{order.maxTeams} · HHE{" "}
                          {order.hheHours.toFixed(1)}h
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${badge.className}`}>
                          <LanguagesIcon className="w-3 h-3" />
                          {t(`languageBadge.${order.languageMatch}`)}
                        </span>
                        <button
                          onClick={() => setEditingOrder(order)}
                          className="flex items-center gap-1 text-xs text-brand-wave-blue hover:text-brand-navy min-h-[36px] px-2 py-1 rounded hover:bg-brand-navy/5 transition-colors touch-manipulation"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          {t("edit")}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {order.assignments.length === 0 ? (
                        <span className="text-xs text-gray-400">{t("noOneAssigned")}</span>
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
                              <span className="text-brand-wave-blue">· {t("lead")}</span>
                            )}
                            {a.lockedByAdmin && <span className="text-brand-gold-dark">· {t("locked")}</span>}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-brand-ink">{t("workdaySummary")}</h2>
              {data.employeeWorkdays.length === 0 ? (
                <p className="text-xs text-gray-400">{t("noOneAssignedYet")}</p>
              ) : (
                data.employeeWorkdays.map((w) => {
                  const badge = WORKDAY_BADGE[w.status];
                  return (
                    <div key={w.employeeId} className="bg-white rounded-xl border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{w.name}</span>
                        <span className={`text-xs font-medium flex items-center gap-1 ${badge.className}`}>
                          {w.status !== "ok" && <ClockAlert className="w-3.5 h-3.5" />}
                          {t(`workdayBadge.${w.status}`)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {t("ordersTotal", { count: w.ordersCount, hours: formatMinutes(w.totalDayMinutes) })}
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
  const t = useTranslations("admin.dispatch");
  const [selected, setSelected] = useState<string[]>(order.assignments.map((a) => a.employeeId));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Fix (auditoría externa 2026-07-31): el modal de edición de asignación
  // no tenía focus trap, ni cerraba con Escape, ni pedía confirmación
  // antes de aplicar el cambio -- un click accidental reasignaba el
  // equipo de una orden real sin previsualización. Se agrega focus trap +
  // Escape (mismo patrón que ConfirmActionModal/AdminRolesClient) y un
  // paso de confirmación con resumen de altas/bajas antes de guardar.
  const [showConfirm, setShowConfirm] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, !showConfirm);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving && !showConfirm) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [saving, showConfirm, onClose]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async () => {
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
        throw new Error(err.error || t("modal.saveError"));
      }
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("modal.saveError"));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const activeEmployees = employees.filter((e) => e.is_active);
  const originalIds = order.assignments.map((a) => a.employeeId);
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name || id;
  const added = selected.filter((id) => !originalIds.includes(id)).map(nameOf);
  const removed = originalIds.filter((id) => !selected.includes(id)).map(nameOf);

  const handleRequestSave = () => {
    if (selected.length === 0) {
      setSaveError(t("modal.selectAtLeastOne"));
      return;
    }
    setSaveError("");
    setShowConfirm(true);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-semibold text-brand-ink">
            {order.serviceTime} — {order.serviceType}
          </h2>
          <p className="text-xs text-gray-500">
            {t("modal.requires", { min: order.minTeams, max: order.maxTeams, languages: order.clientLanguages.join(", ") })}
          </p>
        </div>

        <div className="space-y-1 max-h-64 overflow-y-auto border rounded-lg p-2">
          {activeEmployees.map((emp) => (
            <label key={emp.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                aria-label={t("modal.assignToAriaLabel", { name: emp.name })}
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
          aria-label={t("modal.notesAriaLabel")}
          placeholder={t("modal.notesPlaceholder")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full text-sm border rounded-lg px-3 py-2"
        />

        {saveError && <p className="text-xs text-state-danger">{saveError}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">
            {t("modal.cancel")}
          </button>
          <button
            type="button"
            onClick={handleRequestSave}
            disabled={saving}
            aria-label={saving ? t("modal.savingAriaLabel") : t("modal.saveAriaLabel")}
            className="px-4 py-2 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
          >
            {saving ? t("modal.saving") : t("modal.saveAndLock")}
          </button>
        </div>
      </div>

      {showConfirm && (
        <ConfirmActionModal
          title={t("modal.confirmChangeTitle")}
          message={
            <span>
              {added.length === 0 && removed.length === 0 ? (
                t("modal.confirmNoChanges")
              ) : (
                <>
                  {added.length > 0 && (
                    <span className="block text-state-success">+ {added.join(", ")}</span>
                  )}
                  {removed.length > 0 && (
                    <span className="block text-state-danger">- {removed.join(", ")}</span>
                  )}
                </>
              )}
            </span>
          }
          confirmLabel={t("modal.saveAndLock")}
          onCancel={() => setShowConfirm(false)}
          onConfirm={async () => {
            await handleSave();
            setShowConfirm(false);
          }}
        />
      )}
    </div>
  );
}
