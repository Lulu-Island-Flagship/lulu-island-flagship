"use client";

import React, { useCallback,  useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  Loader2,
  User,
  Mail,
  Shield,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Languages as LanguagesIcon,
  DollarSign,
  Pencil,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { LANGUAGE_LEVELS, type LanguageLevels } from "@/lib/employee-languages";
import { CAREER_LEVEL_ORDER, type CareerLevel } from "@/lib/career-path";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  is_active: boolean;
  day_rate: number;
  languages: string[];
  language_levels: LanguageLevels;
  career_level: CareerLevel;
  created_at: string;
  terminated_at?: string | null;
}

export default function AdminEmpleadosClient() {
  const t = useTranslations("admin.empleados");

  const CAREER_LEVEL_LABEL: Record<CareerLevel, string> = {
    trainee: t("careerLevelTrainee"),
    trabajador: t("careerLevelTeamMember"),
    senior: t("careerLevelSenior"),
    lider: t("careerLevelTeamLead"),
    lider_mentor: t("careerLevelLeadMentor"),
    coordinador_operativo: t("careerLevelOpsCoordinator"),
  };

  const LEVEL_LABEL: Record<string, string> = {
    basic: t("languageLevelBasic"),
    intermediate: t("languageLevelIntermediate"),
    fluent: t("languageLevelFluent"),
    native: t("languageLevelNative"),
  };
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [offboardingEmployee, setOffboardingEmployee] = useState<Employee | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [activateError, setActivateError] = useState("");
  // v8.5: Day Rate editable inline.
  const [editingDayRateId, setEditingDayRateId] = useState<string | null>(null);
  const [dayRateEditValue, setDayRateEditValue] = useState("");
  const [dayRateSaving, setDayRateSaving] = useState(false);
  const [dayRateError, setDayRateError] = useState("");
  // Fix (auditoría externa 2026-07-31, item 11): lista densa sin
  // búsqueda/paginación -- se agrega filtro por nombre/email/rol y
  // paginación simple ("cargar más").
  const [search, setSearch] = useState("");
  const PAGE_SIZE = 25;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function startEditDayRate(employeeId: string, currentDayRate: number) {
    setDayRateError("");
    setEditingDayRateId(employeeId);
    setDayRateEditValue(String(currentDayRate));
  }

  function cancelEditDayRate() {
    setEditingDayRateId(null);
    setDayRateEditValue("");
    setDayRateError("");
  }

  async function saveDayRate(employeeId: string) {
    const trimmed = dayRateEditValue.trim();
    if (!trimmed) {
      cancelEditDayRate();
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      setDayRateError(t("dayRateInvalid"));
      return;
    }
    setDayRateSaving(true);
    setDayRateError("");
    try {
      const res = await fetch(`/api/admin/empleados/${employeeId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayRate: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDayRateError(data.error || t("dayRateSaveFailed"));
        return;
      }
      setEmployees((prev) =>
        prev.map((e) => (e.id === employeeId ? { ...e, day_rate: value } : e))
      );
      setEditingDayRateId(null);
      setDayRateEditValue("");
    } finally {
      setDayRateSaving(false);
    }
  }

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/empleados", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorLoadFailed"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setEmployees(data.employees || []);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);


  async function saveLanguages(employeeId: string, languages: string[], languageLevels: LanguageLevels) {
    const res = await fetch(`/api/admin/empleados/${employeeId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ languages, languageLevels }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || t("errorSaveFailed"));
    }
    const data = await res.json();
    setEmployees((prev) => prev.map((e) => (e.id === employeeId ? data.employee : e)));
  }

  // v8.3: activa a un empleado nuevo (is_active false -> true) y dispara la
  // invitación al Portal de equipo (evento 'employee_invited', migración
  // 202) desde el mismo PATCH -- ver src/app/api/admin/empleados/[id]/route.ts.
  async function activateEmployee(employeeId: string) {
    setActivatingId(employeeId);
    setActivateError("");
    try {
      const res = await fetch(`/api/admin/empleados/${employeeId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errorActivateFailed"));
      setEmployees((prev) => prev.map((e) => (e.id === employeeId ? { ...e, ...data.employee } : e)));
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : t("errorActivateFailed"));
    } finally {
      setActivatingId(null);
    }
  }

  // Fix (auditoría externa 2026-07-31): el <select> disparaba el PATCH
  // apenas cambiaba el valor, con solo un window.confirm() nativo (no
  // estilizable/accesible) como freno -- un click/tap desviado en el
  // <select> (fácil en una tabla densa) cambiaba el nivel de carrera del
  // empleado de inmediato. Se reemplaza por ConfirmActionModal: el
  // <select> ya no dispara el PATCH directamente, solo guarda el cambio
  // pendiente; el PATCH real ocurre en el onConfirm del modal.
  const [pendingCareerLevel, setPendingCareerLevel] = useState<{
    employeeId: string;
    employeeName: string;
    fromLevel: CareerLevel;
    toLevel: CareerLevel;
  } | null>(null);

  async function saveCareerLevel(employeeId: string, careerLevel: CareerLevel) {
    const res = await fetch(`/api/admin/empleados/${employeeId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ careerLevel }),
    });
    if (!res.ok) {
      const err = await res.json();
      setActivateError(err.error || t("saveCareerLevelFailed"));
      throw new Error(err.error || t("saveCareerLevelFailed"));
    }
    const data = await res.json();
    setEmployees((prev) => prev.map((e) => (e.id === employeeId ? data.employee : e)));
  }

  const getRoleBadge = (role: string) => {
    const styles: Record<string, string> = {
      cleaner: "bg-blue-100 text-blue-700",
      supervisor: "bg-purple-100 text-purple-700",
      driver: "bg-orange-100 text-orange-700",
    };
    return styles[role] || "bg-gray-100 text-gray-700";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
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
  const filteredEmployees = searchQuery
    ? employees.filter((emp) =>
        [emp.name, emp.email, emp.role].filter(Boolean).some((f) => f.toLowerCase().includes(searchQuery))
      )
    : employees;
  const visibleEmployees = filteredEmployees.slice(0, visibleCount);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {t("employeeCount", { count: filteredEmployees.length })}
          </span>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light"
          >
            <UserPlus className="w-4 h-4" />
            {t("addEmployee")}
          </button>
        </div>
      </div>

      {activateError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-state-danger">
          {activateError}
        </div>
      )}

      {employees.length > 0 && (
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

      {employees.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <User className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("noEmployeesFound")}</p>
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <p className="text-gray-500">{t("searchNoResults")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("colName")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("colEmail")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("colRole")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("colStatus")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("colDayRate")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("colLanguages")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("colCareerLevel")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600"><span className="sr-only">{t("colActions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="font-medium text-brand-ink">{emp.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Mail className="w-4 h-4 text-gray-400" />
                        <span>{emp.email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getRoleBadge(emp.role)}`}>
                        <Shield className="w-3 h-3 inline mr-1" />
                        {emp.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {emp.is_active ? (
                        <span className="flex items-center gap-1 text-green-600 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t("statusActive")}
                        </span>
                      ) : emp.terminated_at ? (
                        <span className="flex items-center gap-1 text-gray-400 text-xs">
                          <XCircle className="w-3.5 h-3.5" />
                          {t("statusInactive")}
                        </span>
                      ) : (
                        <div className="space-y-1">
                          <span className="flex items-center gap-1 text-brand-gold-dark text-xs">
                            <XCircle className="w-3.5 h-3.5" />
                            {t("statusPendingActivation")}
                          </span>
                          <button
                            type="button"
                            onClick={() => activateEmployee(emp.id)}
                            disabled={activatingId === emp.id}
                            aria-label={activatingId === emp.id ? t("activatingAria", { name: emp.name }) : t("activateInviteAria", { name: emp.name })}
                            className="text-xs text-brand-navy font-medium hover:underline disabled:opacity-50"
                          >
                            {activatingId === emp.id ? t("activating") : t("activateAndInvite")}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {/* v8.5: Day Rate editable inline. */}
                      {editingDayRateId === emp.id ? (
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <input
                            type="number"
                            value={dayRateEditValue}
                            onChange={(e) => { setDayRateEditValue(e.target.value); setDayRateError(""); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveDayRate(emp.id);
                              if (e.key === "Escape") cancelEditDayRate();
                            }}
                            onBlur={() => saveDayRate(emp.id)}
                            disabled={dayRateSaving}
                            min={146}
                            step={1}
                            aria-label={t("dayRateEditAria", { name: emp.name })}
                            className="w-20 px-2 py-1 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-brand-wave-blue/30 focus:border-brand-wave-blue"
                          />
                          {dayRateSaving && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-wave-blue" />
                          )}
                          {dayRateError && (
                            <span className="text-xs text-state-danger" role="alert">{dayRateError}</span>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditDayRate(emp.id, emp.day_rate)}
                          title={t("dayRateTooltip")}
                          aria-label={t("dayRateEditAria", { name: emp.name })}
                          className="flex items-center gap-1 text-sm text-gray-600 hover:text-brand-ink hover:underline"
                        >
                          <DollarSign className="w-3.5 h-3.5 text-gray-400" />
                          <span>${emp.day_rate}</span>
                          <Pencil className="w-3 h-3 text-gray-400 ml-0.5" />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setEditingEmployee(emp)}
                        className="flex items-center gap-1.5 text-xs text-brand-wave-blue hover:text-brand-navy"
                      >
                        <LanguagesIcon className="w-3.5 h-3.5" />
                        {(emp.languages || []).length === 0 ? (
                          <span className="text-gray-400">{t("languagesNotSet")}</span>
                        ) : (
                          <span>
                            {emp.languages
                              .map((code) => {
                                const level = emp.language_levels?.[code];
                                const label = SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label || code;
                                return level ? `${label} (${LEVEL_LABEL[level]})` : label;
                              })
                              .join(", ")}
                          </span>
                        )}
                        <Pencil className="w-3 h-3 text-gray-400" />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        title={t("careerLevelPromotionNotice")}
                        aria-label={t("careerLevelSelectAria")}
                        value={emp.career_level || "trabajador"}
                        onChange={(e) =>
                          setPendingCareerLevel({
                            employeeId: emp.id,
                            employeeName: emp.name,
                            fromLevel: emp.career_level || "trabajador",
                            toLevel: e.target.value as CareerLevel,
                          })
                        }
                        className="text-xs border rounded-md px-2 py-1"
                      >
                        {CAREER_LEVEL_ORDER.map((level) => (
                          <option key={level} value={level}>
                            {CAREER_LEVEL_LABEL[level]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {emp.terminated_at ? (
                        <span className="text-xs text-gray-400">{t("offboarded")}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setOffboardingEmployee(emp)}
                          className="flex items-center gap-1 text-xs text-state-danger hover:opacity-80"
                          title={t("offboardTitle")}
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                          {t("offboardAction")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredEmployees.length > visibleCount && (
            <div className="text-center py-3 border-t">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="text-sm text-brand-wave-blue hover:text-brand-navy font-medium"
              >
                {t("loadMore", { remaining: filteredEmployees.length - visibleCount })}
              </button>
            </div>
          )}
        </div>
      )}

      {editingEmployee && (
        <EditLanguagesModal
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onSave={saveLanguages}
        />
      )}

      {showAddModal && (
        <AddEmployeeModal
          onClose={() => setShowAddModal(false)}
          onCreated={(employee) => {
            setEmployees((prev) => [...prev, employee].sort((a, b) => a.name.localeCompare(b.name)));
            setShowAddModal(false);
          }}
        />
      )}

      {offboardingEmployee && (
        <OffboardModal
          employee={offboardingEmployee}
          onClose={() => setOffboardingEmployee(null)}
          onOffboarded={(employeeId, updated) => {
            setEmployees((prev) =>
              prev.map((e) => (e.id === employeeId ? { ...e, ...updated } : e))
            );
            setOffboardingEmployee(null);
          }}
        />
      )}

      {pendingCareerLevel && (
        <ConfirmActionModal
          title={t("confirmCareerLevelChangeTitle")}
          message={t("confirmCareerLevelChange", {
            name: pendingCareerLevel.employeeName,
            from: CAREER_LEVEL_LABEL[pendingCareerLevel.fromLevel],
            to: CAREER_LEVEL_LABEL[pendingCareerLevel.toLevel],
          })}
          confirmLabel={t("confirmCareerLevelChangeConfirm")}
          onCancel={() => setPendingCareerLevel(null)}
          onConfirm={async () => {
            await saveCareerLevel(pendingCareerLevel.employeeId, pendingCareerLevel.toLevel);
            setPendingCareerLevel(null);
          }}
        />
      )}
    </div>
  );
}

// v8.3 FIX-11: offboarding real -- desactiva, paga el Vacation Pay
// acumulado, revoca el acceso a la cuenta y suelta los servicios futuros
// para reasignación (ver POST /api/admin/empleados/[id]/offboard).
function OffboardModal({
  employee,
  onClose,
  onOffboarded,
}: {
  employee: Employee;
  onClose: () => void;
  onOffboarded: (employeeId: string, updated: Partial<Employee>) => void;
}) {
  const t = useTranslations("admin.empleados");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [result, setResult] = useState<{
    vacationPayoutCents: number;
    accessRevoked: boolean;
    reassignedCount: number;
    inProgressOrders: { orderId: string; serviceDate: string; status: string }[];
  } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleConfirm = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`/api/admin/empleados/${employee.id}/offboard`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminationReason: reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errorOffboardFailed"));
      setResult({
        vacationPayoutCents: data.vacationPayoutCents,
        accessRevoked: data.accessRevoked,
        reassignedCount: data.reassignedCount,
        inProgressOrders: data.inProgressOrders || [],
      });
      onOffboarded(employee.id, {
        is_active: false,
        terminated_at: data.employee.terminated_at,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("errorOffboardFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-brand-ink">{t("offboardModalHeading", { name: employee.name })}</h2>

        {result ? (
          <div className="space-y-2 text-sm text-brand-ink">
            <p className="text-state-success font-medium">{t("offboardSuccess")}</p>
            <p>{t("offboardVacationPaid", { amount: (result.vacationPayoutCents / 100).toFixed(2) })}</p>
            <p>{t("offboardAccessRevoked", { status: result.accessRevoked ? t("yes") : t("noCheckCredentials") })}</p>
            <p>{t("offboardFutureReleased", { count: result.reassignedCount })}</p>
            {result.inProgressOrders.length > 0 && (
              <div className="bg-state-danger/5 border border-state-danger/20 rounded-lg p-3 mt-2">
                <p className="font-medium text-state-danger">
                  {t("offboardInProgressWarning", { count: result.inProgressOrders.length })}
                </p>
                <ul className="list-disc list-inside mt-1">
                  {result.inProgressOrders.map((o) => (
                    <li key={o.orderId}>
                      {t("offboardOrderLine", { orderId: o.orderId.slice(0, 8), date: o.serviceDate, status: o.status })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light"
              >
                {t("done")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              {t("offboardExplanation")}
            </p>
            <div>
              <label htmlFor="offboard-termination-reason" className="text-xs text-gray-600 block mb-1">{t("offboardReasonLabel")}</label>
              <textarea
                id="offboard-termination-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                rows={3}
                placeholder={t("offboardReasonPlaceholder")}
              />
            </div>
            {saveError && <p className="text-xs text-state-danger">{saveError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={saving || !reason.trim()}
                aria-label={saving ? t("offboardingAria") : t("confirmOffboardAria")}
                className="px-4 py-2 text-sm rounded-lg bg-state-danger text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? t("processing") : t("confirmOffboard")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// v8.3 FIX-10: onboarding real -- antes no había ninguna forma en el
// producto de crear un empleado nuevo (ver POST /api/admin/empleados).
// Se crea SIEMPRE inactivo (is_active=false); el admin lo activa aparte
// una vez completado el papeleo/orientación real del primer día.
function AddEmployeeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (employee: Employee) => void;
}) {
  const t = useTranslations("admin.empleados");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("cleaner");
  const [dayRate, setDayRate] = useState("200");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleCreate = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/admin/empleados", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone: phone || undefined,
          role,
          dayRate: dayRate ? Number(dayRate) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("errorCreateFailed"));
      onCreated(data.employee);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("errorCreateFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-brand-ink">{t("addEmployeeModalHeading")}</h2>
        <p className="text-xs text-gray-500">
          {t("addEmployeeModalDescription")}
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="add-employee-name" className="text-xs text-gray-600 block mb-1">{t("nameLabel")}</label>
            <input
              id="add-employee-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder={t("namePlaceholder")}
            />
          </div>
          <div>
            <label htmlFor="add-employee-email" className="text-xs text-gray-600 block mb-1">{t("emailLabel")}</label>
            <input
              id="add-employee-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder={t("emailPlaceholder")}
            />
          </div>
          <div>
            <label htmlFor="add-employee-phone" className="text-xs text-gray-600 block mb-1">{t("phoneLabelOptional")}</label>
            <input
              id="add-employee-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="add-employee-role" className="text-xs text-gray-600 block mb-1">{t("roleLabel")}</label>
            <select
              id="add-employee-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="cleaner">{t("roleCleaner")}</option>
              <option value="supervisor">{t("roleSupervisor")}</option>
              <option value="driver">{t("roleDriver")}</option>
            </select>
          </div>
          <div>
            <label htmlFor="add-employee-day-rate" className="text-xs text-gray-600 block mb-1">{t("dayRateLabel")}</label>
            <input
              id="add-employee-day-rate"
              type="number"
              value={dayRate}
              onChange={(e) => setDayRate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        {saveError && <p className="text-xs text-state-danger">{saveError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !name.trim() || !email.trim()}
            aria-label={saving ? t("creatingAria") : t("createAria")}
            className="px-4 py-2 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
          >
            {saving ? t("creating") : t("create")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditLanguagesModal({
  employee,
  onClose,
  onSave,
}: {
  employee: Employee;
  onClose: () => void;
  onSave: (employeeId: string, languages: string[], languageLevels: LanguageLevels) => Promise<void>;
}) {
  const t = useTranslations("admin.empleados");
  const [languages, setLanguages] = useState<string[]>(employee.languages || []);
  const [levels, setLevels] = useState<LanguageLevels>(employee.language_levels || {});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const LEVEL_LABEL: Record<string, string> = {
    basic: t("languageLevelBasic"),
    intermediate: t("languageLevelIntermediate"),
    fluent: t("languageLevelFluent"),
    native: t("languageLevelNative"),
  };

  const toggleLanguage = (code: string) => {
    setLanguages((prev) => {
      if (prev.includes(code)) {
        // Al quitar el idioma, su nivel deja de tener sentido (invariante:
        // languageLevels ⊆ languages, ver isValidLanguageLevels).
        setLevels((prevLevels) => {
          const next = { ...prevLevels };
          delete next[code];
          return next;
        });
        return prev.filter((c) => c !== code);
      }
      return [...prev, code];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(employee.id, languages, levels);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("errorSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-brand-ink">
          {t("editLanguagesHeading", { name: employee.name })}
        </h2>
        <p className="text-xs text-gray-500">
          {t("editLanguagesDescription")}
        </p>

        <div className="space-y-3">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const spoken = languages.includes(lang.code);
            return (
              <div key={lang.code} className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label={t("speaksLanguageAria", { language: lang.label })}
                    checked={spoken}
                    onChange={() => toggleLanguage(lang.code)}
                    className="w-4 h-4 accent-brand-gold"
                  />
                  <span className="text-sm">{lang.label}</span>
                </label>
                <select
                  disabled={!spoken}
                  aria-label={t("languageLevelAria", { language: lang.label })}
                  value={levels[lang.code] || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setLevels((prev) => {
                      if (!value) {
                        const next = { ...prev };
                        delete next[lang.code];
                        return next;
                      }
                      return { ...prev, [lang.code]: value as LanguageLevels[string] };
                    });
                  }}
                  className="text-xs border rounded-md px-2 py-1 disabled:opacity-40 disabled:bg-gray-50"
                >
                  <option value="">{t("noLevelSet")}</option>
                  {LANGUAGE_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {LEVEL_LABEL[lvl]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {saveError && <p className="text-xs text-state-danger">{saveError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || languages.length === 0}
            aria-label={saving ? t("savingAria") : t("saveAria")}
            className="px-4 py-2 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
