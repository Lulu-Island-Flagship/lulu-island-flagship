"use client";

import React, { useState, useEffect, useRef } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useTranslations } from "next-intl";
import {
  Loader2,
  MapPin,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Users,
  X,
} from "lucide-react";
import ErrorBoundary from "@/components/ui/ErrorBoundary"; // Fix M7: error boundary

interface AdminService {
  orderId: string;
  serviceDate: string;
  serviceTime: string;
  orderStatus: string;
  assignmentStatus: string;
  employeeName: string;
  address: string;
  zone: string;
  serviceType: string;
  serviceSubtype: string;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  total: number;
  completedItems: number;
  totalItems: number;
  percentComplete: number;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export default function AdminServiciosClient() {
  const t = useTranslations("admin.servicios");
  const [services, setServices] = useState<AdminService[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fix (auditoría externa 2026-07-31, item 11): lista densa sin
  // búsqueda/paginación -- se agrega filtro por texto (empleado,
  // dirección, zona, tipo de servicio) y paginación simple ("cargar más")
  // para no renderizar cientos de tarjetas de una sola vez.
  const [search, setSearch] = useState("");
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [dispatchOrderId, setDispatchOrderId] = useState<string | null>(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState("");
  // Fix (auditoría externa 2026-07-31): loadEmployees fallaba en silencio
  // (catch vacío) -- el modal de despacho quedaba con la lista vacía sin
  // ninguna explicación de por qué. Se guarda el error para mostrarlo
  // dentro del modal cuando se abre.
  const [employeesLoadError, setEmployeesLoadError] = useState(false);

  // Item 12 (auditoría 2026-07-25): el modal de despacho no tenía focus
  // trap ni cierre con Escape.
  const dispatchModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dispatchModalRef, !!dispatchOrderId);
  useEffect(() => {
    if (!dispatchOrderId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDispatchOrderId(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dispatchOrderId]);

  useEffect(() => {
    loadServices();
    loadEmployees();
  }, []);

  async function loadServices() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/servicios", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setServices(data.services || []);
    } catch {
      setError(t("errors.networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployees() {
    try {
      const res = await fetch("/api/admin/empleados", { credentials: "include" });
      if (!res.ok) {
        setEmployeesLoadError(true);
        return;
      }
      const data = await res.json();
      setEmployees((data.employees || []).filter((e: Employee) => e.is_active));
      setEmployeesLoadError(false);
    } catch {
      // Non-blocking for the page load, but surfaced in the dispatch modal
      // so the admin knows the empty list is a load failure, not "no employees".
      setEmployeesLoadError(true);
    }
  }

  async function handleDispatch(orderId: string) {
    if (selectedEmployeeIds.length === 0) {
      setDispatchError(t("dispatch.selectEmployeeError"));
      return;
    }

    setDispatchLoading(true);
    setDispatchError("");

    try {
      const res = await fetch("/api/admin/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId,
          employeeIds: selectedEmployeeIds,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setDispatchError(data.error || t("dispatch.dispatchFailed"));
        setDispatchLoading(false);
        return;
      }

      setDispatchOrderId(null);
      setSelectedEmployeeIds([]);
      await loadServices();
    } catch {
      setDispatchError(t("errors.networkError"));
    } finally {
      setDispatchLoading(false);
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-gray-100 text-gray-700",
      en_route: "bg-blue-100 text-blue-700",
      arrived: "bg-yellow-100 text-yellow-700",
      in_progress: "bg-purple-100 text-purple-700",
      completed: "bg-green-100 text-green-700",
      cancelled: "bg-red-100 text-red-700",
      no_show: "bg-red-100 text-red-700",
    };
    return styles[status] || "bg-gray-100 text-gray-700";
  };

  const knownStatuses = ["pending", "en_route", "arrived", "in_progress", "completed", "cancelled", "no_show"];

  const formatStatus = (status: string) => {
    if (knownStatuses.includes(status)) {
      return t(`statusLabels.${status}` as "statusLabels.pending");
    }
    return status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700 font-medium">{error}</p>
      </div>
    );
  }

  const searchQuery = search.trim().toLowerCase();
  const filteredServices = searchQuery
    ? services.filter((s) =>
        [s.employeeName, s.address, s.zone, s.serviceSubtype, s.serviceType]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(searchQuery))
      )
    : services;
  const visibleServices = filteredServices.slice(0, visibleCount);

  return (
    <ErrorBoundary>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <span className="text-sm text-gray-500">
          {t("serviceCount", { count: filteredServices.length })}
        </span>
      </div>

      {services.length > 0 && (
        <div className="max-w-md">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchAriaLabel")}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-sm"
          />
        </div>
      )}

      {services.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("noServicesToday")}</p>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <p className="text-gray-500">{t("searchNoResults")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleServices.map((s) => (
            <div
              key={s.orderId}
              className="w-full bg-white rounded-xl border p-4 text-left hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getStatusBadge(s.assignmentStatus)}`}>
                      {formatStatus(s.assignmentStatus)}
                    </span>
                    <span className="text-xs text-gray-400">{s.serviceSubtype.replace(/_/g, " ")}</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-brand-ink">
                    <Clock className="w-4 h-4 text-brand-gold" />
                    <span className="font-medium">{s.serviceTime}</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    <span className="truncate">{s.address}, {s.zone}</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <User className="w-4 h-4 text-gray-400" />
                    <span>{s.employeeName}</span>
                  </div>

                  {s.totalItems > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-brand-gold h-2 rounded-full transition-all"
                          style={{ width: `${s.percentComplete}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {s.percentComplete}% ({s.completedItems}/{s.totalItems})
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <a
                    href={`./servicios/${s.orderId}`}
                    className="p-2 text-gray-400 hover:text-brand-navy transition-colors"
                    title={t("viewDetails")}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </a>
                  <button
                    onClick={() => {
                      setDispatchOrderId(s.orderId);
                      setSelectedEmployeeIds([]);
                      setDispatchError("");
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-navy hover:text-brand-navy-light bg-brand-navy/5 hover:bg-brand-navy/10 px-2 py-1 rounded transition-colors"
                    title={t("assignTeam")}
                  >
                    <Users className="w-3.5 h-3.5" />
                    {t("assign")}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {filteredServices.length > visibleCount && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="text-sm text-brand-wave-blue hover:text-brand-navy font-medium"
              >
                {t("loadMore", { remaining: filteredServices.length - visibleCount })}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Dispatch Modal */}
      {dispatchOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div ref={dispatchModalRef} role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-elevation-2 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-brand-ink">{t("dispatch.title")}</h2>
              <button
                type="button"
                onClick={() => setDispatchOrderId(null)}
                aria-label={t("dispatch.closeDialog")}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <p className="text-sm text-gray-600">
              {t("dispatch.selectEmployeesFor")}{" "}
              <span className="font-mono text-xs">{dispatchOrderId.slice(0, 8)}</span>
            </p>

            {employeesLoadError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-red-700">{t("dispatch.employeesLoadError")}</p>
                  <button
                    type="button"
                    onClick={() => loadEmployees()}
                    className="text-xs text-red-700 underline hover:no-underline mt-1"
                  >
                    {t("dispatch.retry")}
                  </button>
                </div>
              </div>
            )}

            {employees.length === 0 ? (
              <p className="text-sm text-gray-500">
                {employeesLoadError ? "" : t("dispatch.noEmployeesAvailable")}
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                {employees.map((emp) => (
                  <label
                    key={emp.id}
                    className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      aria-label={t("dispatch.assignToEmployee", { name: emp.name })}
                      className="w-4 h-4 text-brand-navy rounded"
                      checked={selectedEmployeeIds.includes(emp.id)}
                      onChange={(e) => {
                        setSelectedEmployeeIds((prev) =>
                          e.target.checked
                            ? [...prev, emp.id]
                            : prev.filter((id) => id !== emp.id)
                        );
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-brand-ink truncate">{emp.name}</p>
                      <p className="text-xs text-gray-500 truncate">{emp.email}</p>
                    </div>
                    <span className="text-xs text-gray-400 capitalize">{emp.role}</span>
                  </label>
                ))}
              </div>
            )}

            {dispatchError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
                {dispatchError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setDispatchOrderId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                {t("dispatch.cancel")}
              </button>
              <button
                onClick={() => handleDispatch(dispatchOrderId)}
                disabled={dispatchLoading || selectedEmployeeIds.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-navy text-white rounded-lg hover:bg-brand-navy-light transition-colors disabled:opacity-50"
              >
                {dispatchLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("dispatch.title")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
