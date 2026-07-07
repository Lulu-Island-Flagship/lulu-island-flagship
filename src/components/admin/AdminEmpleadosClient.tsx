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
} from "lucide-react";

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  is_active: boolean;
  day_rate: number;
  languages: string[];
  created_at: string;
}

export default function AdminEmpleadosClient() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
