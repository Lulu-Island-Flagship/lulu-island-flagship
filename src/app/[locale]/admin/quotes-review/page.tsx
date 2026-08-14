"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { Loader2, AlertCircle, CheckCircle2, XCircle } from "lucide-react";

interface PendingQuote {
  id: string;
  service_category: string;
  service_subtype: string;
  bedrooms: number;
  bathrooms: number;
  square_feet: number;
  address: string;
  zone: string;
  subtotal: number;
  total: number;
  hold_amount: number;
  estimated_margin_contribution: number;
  admin_review_reason: string;
  client_score: number;
  created_at: string;
}

export default function QuotesReviewPage() {
  const t = useTranslations("admin.quotesReview");
  const [quotes, setQuotes] = useState<PendingQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Fix (auditoría de autenticación 2026-07-25/26, item 3): getSession()
      // solo lee el JWT local sin validarlo contra el servidor -- inseguro
      // para decisiones de negocio. Se usa getUser() (valida contra Auth).
      // El header Authorization tampoco servía de nada: la API
      // (/api/admin/quotes, vía requireAdminRole en src/lib/admin.ts) se
      // autentica con la cookie de sesión, nunca leyó este header -- se
      // elimina ese código muerto junto con el cambio.
      await supabase.auth.getUser();
      const res = await fetch("/api/admin/quotes?review=true", {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setQuotes(data.quotes || []);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  async function handleReview(quoteId: string, action: "approve" | "reject") {
    setProcessingId(quoteId);
    try {
      // Fix (item 3): getUser() en vez de getSession() -- ver comentario en
      // loadQuotes(). El header Authorization tampoco lo usa el servidor
      // (cookies vía requireAdminRole).
      await supabase.auth.getUser();
      const res = await fetch(`/api/admin/quotes/${quoteId}/review`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          reason: action === "approve" ? t("approvedReason") : t("rejectedReason"),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.reviewFailed"));
        return;
      }
      await loadQuotes();
    } catch {
      setError(t("errors.networkReview"));
    } finally {
      setProcessingId(null);
    }
  }

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <span className="text-sm text-gray-500">{t("pendingCount", { count: quotes.length })}</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {quotes.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("emptyState")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map((q) => (
            <div key={q.id} className="bg-white rounded-xl border p-5">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      {t("reviewRequired")}
                    </span>
                    <span className="text-xs text-gray-400">{q.service_subtype.replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-sm text-brand-ink font-medium">
                    {q.address}, {q.zone}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t("bedBathSqft", { bed: q.bedrooms, bath: q.bathrooms, sqft: q.square_feet })}
                  </p>
                  <p className="text-xs text-red-600 mt-1">{q.admin_review_reason}</p>
                  <p className="text-xs text-gray-400">{t("clientScore", { score: q.client_score })}</p>
                </div>

                <div className="text-right space-y-1 min-w-[140px]">
                  <p className="text-lg font-bold text-brand-ink">{formatCurrency(q.total)}</p>
                  <p className="text-xs text-gray-500">{t("hold", { amount: formatCurrency(q.hold_amount) })}</p>
                  <p className="text-xs text-gray-500">
                    {t("margin", { pct: ((q.estimated_margin_contribution || 0) * 100).toFixed(1) })}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t">
                <button
                  onClick={() => handleReview(q.id, "reject")}
                  disabled={processingId === q.id}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  {t("reject")}
                </button>
                <button
                  onClick={() => handleReview(q.id, "approve")}
                  disabled={processingId === q.id}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-brand-navy hover:bg-brand-navy-light rounded-lg transition-colors disabled:opacity-50"
                >
                  {processingId === q.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {t("approve")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
