"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Tag,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  MapPin,
  User,
} from "lucide-react";

interface Upsell {
  id: string;
  order_id: string;
  employee_id: string;
  upsell_type: string;
  upsell_label: string;
  amount: number;
  client_approved: boolean;
  notes?: string;
  reviewed_by_admin: boolean;
  approval_status?: "auto_approved" | "pending_admin_approval" | "admin_approved" | "admin_rejected";
  created_at: string;
  orders?: {
    service_date: string;
    service_time: string;
    quotes?: { address: string } | null;
  } | null;
  employees?: {
    name: string;
    email: string;
  } | null;
}

export default function AdminUpsellsClient() {
  const t = useTranslations("admin.upsells");
  const [upsells, setUpsells] = useState<Upsell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    loadUpsells();
  }, []);

  async function loadUpsells() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/upsells", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorLoadFailed"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setUpsells(data.upsells || []);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }

  // Bug auditoría (AdminUpsellsClient no aprueba realmente el upsell): este
  // botón hacía POST sin body, que el endpoint interpreta como
  // "comportamiento legado" -- solo marca reviewed_by_admin=true sin tocar
  // approval_status, así que el upsell nunca queda realmente aprobado ni
  // rechazado (el dinero queda en limbo). El endpoint SÍ soporta
  // { action: "approve" | "reject", reason? } (ver route.ts) -- se envía
  // ese body explícitamente.
  async function reviewUpsell(id: string, action?: "approve" | "reject", reason?: string) {
    setReviewing(id);
    try {
      const res = await fetch(`/api/admin/upsells/${id}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (res.ok) {
        setUpsells((prev) => prev.filter((u) => u.id !== id));
        setRejectingId(null);
        setRejectReason("");
      } else {
        const err = await res.json();
        setError(err.error || t("errorMarkReviewedFailed"));
      }
    } catch (e) {
      console.error("Review error:", e);
      setError(t("reviewError"));
    } finally {
      setReviewing(null);
    }
  }

  const formatDate = (date: string) => {
    const vancouverDate = new Date(date).toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return vancouverDate.split(",")[0]; // YYYY-MM-DD
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
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <span className="text-sm text-gray-500">
          {t("pendingCount", { count: upsells.length })}
        </span>
      </div>

      {upsells.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-2" />
          <p className="text-gray-500">{t("allReviewed")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {upsells.map((u) => (
            <div key={u.id} className="bg-white rounded-xl border p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-brand-gold" />
                    <span className="font-medium text-brand-ink">{u.upsell_label}</span>
                    <span className="text-xs text-gray-400">{u.upsell_type}</span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <DollarSign className="w-4 h-4 text-gray-400" />
                    <span className="font-medium">${u.amount}</span>
                    {u.client_approved ? (
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                        {t("clientApproved")}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        {t("pendingClientApproval")}
                      </span>
                    )}
                  </div>

                  {u.orders?.quotes?.address && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <MapPin className="w-4 h-4 text-gray-400" />
                      <span>{u.orders.quotes.address}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <User className="w-4 h-4 text-gray-400" />
                    <span>{u.employees?.name || t("unknownEmployee")}</span>
                    <span className="text-gray-300">|</span>
                    <span>{formatDate(u.created_at)}</span>
                  </div>

                  {u.notes && (
                    <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2">
                      {u.notes}
                    </p>
                  )}
                </div>
              </div>

              {u.approval_status === "pending_admin_approval" ? (
                <div className="space-y-2">
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1">
                    {t("requiresApproval")}
                  </p>
                  {rejectingId === u.id ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder={t("rejectReasonPlaceholder")}
                        className="w-full text-sm border rounded-lg px-3 py-2"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason("");
                          }}
                          className="flex-1 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                        >
                          {t("cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewUpsell(u.id, "reject", rejectReason.trim() || undefined)}
                          disabled={reviewing === u.id}
                          className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {reviewing === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          {t("confirmReject")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setRejectingId(u.id)}
                        disabled={reviewing === u.id}
                        className="flex-1 py-2 border border-red-200 text-red-600 rounded-lg font-medium text-sm hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {t("reject")}
                      </button>
                      <button
                        type="button"
                        onClick={() => reviewUpsell(u.id, "approve")}
                        disabled={reviewing === u.id}
                        className="flex-1 py-2 bg-brand-navy text-white rounded-lg font-medium text-sm hover:bg-brand-navy/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {reviewing === u.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        {t("approve")}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => reviewUpsell(u.id)}
                  disabled={reviewing === u.id}
                  className="w-full py-2 bg-brand-navy text-white rounded-lg font-medium text-sm hover:bg-brand-navy/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {reviewing === u.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {t("markAsReviewed")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
