"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Users,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface Applicant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string | null;
  status: string;
  createdAt: string;
  position: string;
  hasResume: boolean;
}

const STATUS_FILTERS = ["all", "step1_completed", "approved", "rejected"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_COLORS: Record<string, string> = {
  step1_completed: "bg-blue-100 text-blue-700",
  step2_completed: "bg-amber-100 text-amber-700",
  step3_completed: "bg-purple-100 text-purple-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function AdminApplicantsPage() {
  const t = useTranslations("admin.applicants");
  const params = useParams();
  const locale = (params?.locale as string) || "en";

  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("step1_completed");
  const [page, setPage] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const PAGE_SIZE = 25;

  useEffect(() => {
    loadApplicants();
  }, [statusFilter, page]);

  async function loadApplicants() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));

      const res = await fetch(`/api/admin/applicants?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setError(err?.error || t("errorLoadFailed"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setApplicants(data.applicants || []);
      setTotal(data.total || 0);
    } catch {
      setError(t("errorLoadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(applicantId: string, action: "approve" | "reject") {
    if (
      !window.confirm(
        action === "approve"
          ? t("actions.approveConfirm")
          : t("actions.rejectConfirm")
      )
    )
      return;

    setActionLoading(applicantId);
    try {
      const res = await fetch(`/api/admin/applicants/${applicantId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error || t("errorActionFailed"));
        return;
      }
      // Recargar la lista
      loadApplicants();
    } catch {
      alert(t("errorActionFailed"));
    } finally {
      setActionLoading(null);
    }
  }

  async function viewResume(applicantId: string) {
    try {
      const res = await fetch(
        `/api/admin/applicants/resume/${applicantId}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        alert("No resume available");
        return;
      }
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        alert("No resume available");
      }
    } catch {
      alert("Failed to retrieve resume");
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

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
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-6 h-6 text-brand-navy" />
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
          <p className="text-sm text-gray-500">{t("subtitle")}</p>
        </div>
      </div>

      {/* Filtros de status */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => {
              setStatusFilter(filter);
              setPage(0);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === filter
                ? "bg-brand-navy text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t(`statusFilter.${filter}`)}
          </button>
        ))}
      </div>

      {applicants.length === 0 ? (
        <div className="bg-white rounded-lg shadow-elevation-1 p-8 text-center">
          <p className="text-gray-500">{t("table.noApplications")}</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-elevation-1 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">
                      {t("table.name")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">
                      {t("table.email")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">
                      {t("table.phone")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">
                      {t("table.position")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">
                      {t("table.status")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">
                      {t("table.appliedDate")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">
                      {t("table.resume")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">
                      {t("table.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {applicants.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-brand-ink">
                        {[a.firstName, a.lastName].filter(Boolean).join(" ")}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{a.email}</td>
                      <td className="px-4 py-3 text-gray-600">{a.phone}</td>
                      <td className="px-4 py-3 text-gray-600">{a.position}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                            STATUS_COLORS[a.status] || "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {t(`status.${a.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleDateString(locale, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        {a.hasResume ? (
                          <button
                            onClick={() => viewResume(a.id)}
                            className="text-brand-wave-blue hover:underline flex items-center gap-1"
                          >
                            <FileText className="w-4 h-4" />
                            {t("table.resume")}
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">
                            {t("table.noResume")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(a.status === "step1_completed" ||
                          a.status === "step2_completed" ||
                          a.status === "step3_completed") && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAction(a.id, "approve")}
                              disabled={actionLoading === a.id}
                              className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50 transition-colors"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {t("actions.approve")}
                            </button>
                            <button
                              onClick={() => handleAction(a.id, "reject")}
                              disabled={actionLoading === a.id}
                              className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              {t("actions.reject")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 text-sm text-brand-navy hover:underline disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <span className="text-sm text-gray-500">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 text-sm text-brand-navy hover:underline disabled:opacity-30"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
