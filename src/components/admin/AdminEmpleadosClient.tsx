"use client";

import React, { useState, useEffect } from "react";
import {
  Loader2,
  User,
  Mail,
  Shield,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Languages as LanguagesIcon,
  Pencil,
} from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { LANGUAGE_LEVELS, type LanguageLevels } from "@/lib/employee-languages";
import { CAREER_LEVEL_ORDER, type CareerLevel } from "@/lib/career-path";

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
}

const CAREER_LEVEL_LABEL: Record<CareerLevel, string> = {
  trabajador: "Team Member",
  senior: "Senior",
  lider: "Team Lead",
  lider_mentor: "Lead Mentor",
  coordinador_operativo: "Ops Coordinator",
};

const LEVEL_LABEL: Record<string, string> = {
  basic: "Basic",
  intermediate: "Intermediate",
  fluent: "Fluent",
  native: "Native",
};

export default function AdminEmpleadosClient() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    loadEmployees();
  }, []);

  async function loadEmployees() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/empleados", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load employees");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setEmployees(data.employees || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function saveLanguages(employeeId: string, languages: string[], languageLevels: LanguageLevels) {
    const res = await fetch(`/api/admin/empleados/${employeeId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ languages, languageLevels }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to save");
    }
    const data = await res.json();
    setEmployees((prev) => prev.map((e) => (e.id === employeeId ? data.employee : e)));
  }

  async function saveCareerLevel(employeeId: string, careerLevel: CareerLevel) {
    const res = await fetch(`/api/admin/empleados/${employeeId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ careerLevel }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to save career level");
      return;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">Employees</h1>
        <span className="text-sm text-gray-500">
          {employees.length} employee{employees.length !== 1 ? "s" : ""}
        </span>
      </div>

      {employees.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <User className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">No employees found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Day Rate</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Languages</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Career Level</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {employees.map((emp) => (
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
                          Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-gray-400 text-xs">
                          <XCircle className="w-3.5 h-3.5" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">${emp.day_rate}/day</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setEditingEmployee(emp)}
                        className="flex items-center gap-1.5 text-xs text-brand-wave-blue hover:text-brand-navy"
                      >
                        <LanguagesIcon className="w-3.5 h-3.5" />
                        {(emp.languages || []).length === 0 ? (
                          <span className="text-gray-400">Not set</span>
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
                        value={emp.career_level || "trabajador"}
                        onChange={(e) => saveCareerLevel(emp.id, e.target.value as CareerLevel)}
                        className="text-xs border rounded-md px-2 py-1"
                        title="Promotions to Team Lead+ require certification and recommendation the system can't verify — confirm those manually before selecting."
                      >
                        {CAREER_LEVEL_ORDER.map((level) => (
                          <option key={level} value={level}>
                            {CAREER_LEVEL_LABEL[level]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingEmployee && (
        <EditLanguagesModal
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onSave={saveLanguages}
        />
      )}
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
  const [languages, setLanguages] = useState<string[]>(employee.languages || []);
  const [levels, setLevels] = useState<LanguageLevels>(employee.language_levels || {});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-brand-ink">
          Languages — {employee.name}
        </h2>
        <p className="text-xs text-gray-500">
          Used by dispatch to match this employee to accounts with the same
          preferred language (B.2.13). A level is optional but recommended.
        </p>

        <div className="space-y-3">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const spoken = languages.includes(lang.code);
            return (
              <div key={lang.code} className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={spoken}
                    onChange={() => toggleLanguage(lang.code)}
                    className="w-4 h-4 accent-brand-gold"
                  />
                  <span className="text-sm">{lang.label}</span>
                </label>
                <select
                  disabled={!spoken}
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
                  <option value="">No level set</option>
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
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || languages.length === 0}
            className="px-4 py-2 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
