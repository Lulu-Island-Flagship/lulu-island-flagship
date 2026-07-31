"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  User,
  Calendar,
  Camera,
  X,
} from "lucide-react";

interface QCPhoto {
  url: string;
  label: string;
}

interface QCReview {
  id: string;
  order_id: string;
  employee_id: string;
  status: "pending" | "approved" | "rejected" | "auto";
  note: string;
  reviewed_at: string;
  created_at: string;
  orders: { service_date: string; service_time: string } | null;
  employees: { name: string; trust_level: string } | null;
  photos?: QCPhoto[];
}

export default function AdminQCClient() {
  const t = useTranslations("admin.qc");
  const tCommon = useTranslations("common");
  const [reviews, setReviews] = useState<QCReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [selectedReview, setSelectedReview] = useState<QCReview | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"approved" | "rejected">("approved");
  const [submitting, setSubmitting] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(lightboxRef, !!lightboxUrl);
  const reviewModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(reviewModalRef, !!selectedReview);

  // Item 4 (auditoría 2026-07-25): el lightbox de fotos QC usaba
  // role="button" en el fondo con onClick para cerrar -- sin focus trap ni
  // manejo confiable de teclado, y cerraba con cualquier click accidental
  // sobre el fondo. Ahora solo cierra con Escape o el botón de la X, y
  // atrapa el foco mientras está abierto (useFocusTrap, arriba).
  useEffect(() => {
    if (!lightboxUrl) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxUrl(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightboxUrl]);

  // Fix (auditoría 2026-07-30, item 8): el modal de aprobar/rechazar QC
  // (selectedReview) no atrapaba el foco ni cerraba con Escape -- mismo
  // patrón ya aplicado al lightbox arriba y a otros modales corregidos en
  // rondas anteriores (AdminRolesClient, AdminChecklistsClient).
  useEffect(() => {
    if (!selectedReview) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedReview(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedReview]);

  useEffect(() => {
    loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function loadReviews() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/qc?status=${statusFilter}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setReviews(data.reviews || []);
    } catch {
      setError(t("errors.networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function submitReview(orderId: string) {
    if (!reviewNote.trim()) {
      setError(t("errors.noteRequired"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/qc/${orderId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: reviewStatus, note: reviewNote.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.submitFailed"));
        setSubmitting(false);
        return;
      }
      setSelectedReview(null);
      setReviewNote("");
      loadReviews();
    } catch {
      setError(t("errors.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-700";
      case "approved":
      case "auto":
        return "bg-green-100 text-green-700";
      case "rejected":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const formatStatus = (status: string) => {
    if (status === "auto") return t("status.auto");
    return t(`status.${status}` as "status.pending" | "status.approved" | "status.rejected");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <div className="flex gap-2">
          {["pending", "approved", "rejected", "auto"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s
                  ? "bg-brand-navy text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s === "auto" ? t("filters.auto") : t(`filters.${s}` as "filters.pending" | "filters.approved" | "filters.rejected")}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : error && !selectedReview ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">
            {t("emptyWithFilter", {
              filter: statusFilter === "auto" ? t("filters.auto") : t(`filters.${statusFilter}` as "filters.pending" | "filters.approved" | "filters.rejected"),
            })}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getStatusBadge(review.status)}`}>
                  {formatStatus(review.status)}
                </span>
                <span className="text-xs text-gray-400">
                  {review.orders?.service_date || "—"}
                </span>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-brand-ink">
                  <User className="w-4 h-4 text-gray-400" />
                  <span className="font-medium">{review.employees?.name || t("unknownEmployee")}</span>
                  <span className="text-xs text-gray-400 capitalize">
                    ({review.employees?.trust_level || t("modal.standardTrustLevel")})
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span>{review.orders?.service_time || "—"}</span>
                </div>
              </div>

              {review.photos && review.photos.length > 0 ? (
                <div className="grid grid-cols-4 gap-1 mb-3">
                  {review.photos.slice(0, 8).map((photo, idx) => (
                    <button
                      key={`${photo.url}-${idx}`}
                      type="button"
                      onClick={() => setLightboxUrl(photo.url)}
                      className="relative aspect-square rounded-md overflow-hidden border border-gray-200 hover:opacity-80 transition-opacity"
                      title={photo.label}
                    >
                      {/* Item 5 (auditoría 2026-07-25): las fotos vienen de
                          Supabase Storage (dominio dinámico por proyecto, no
                          configurado en next.config.mjs images.remotePatterns),
                          así que se usa `unoptimized` en vez de agregar un
                          remotePattern a ciegas -- sigue dando lazy-loading
                          nativo del navegador y layout estable via `fill`. */}
                      <Image
                        src={photo.url}
                        alt={photo.label || t("photos.altText")}
                        fill
                        unoptimized
                        sizes="(max-width: 768px) 25vw, 150px"
                        className="object-cover"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
                  <Camera className="w-4 h-4" />
                  <span>{t("photos.none")}</span>
                </div>
              )}

              {review.note && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2 mb-3">
                  {review.note}
                </p>
              )}

              {review.status === "pending" && (
                <button
                  onClick={() => {
                    setSelectedReview(review);
                    setReviewNote("");
                    setReviewStatus("approved");
                    setError("");
                  }}
                  className="w-full bg-brand-navy text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
                >
                  {t("reviewButton")}
                </button>
              )}

              {review.status !== "pending" && review.reviewed_at && (
                <p className="text-xs text-gray-400 text-center">
                  {t("reviewedOn", { date: new Date(review.reviewed_at).toLocaleDateString() })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Review Modal */}
      {selectedReview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div
            ref={reviewModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="qc-review-modal-title"
            className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 id="qc-review-modal-title" className="text-lg font-bold text-brand-ink">{t("modal.title")}</h2>
              <button
                onClick={() => setSelectedReview(null)}
                aria-label={tCommon("close")}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <p><strong>{t("modal.employeeLabel")}:</strong> {selectedReview.employees?.name}</p>
              <p><strong>{t("modal.dateLabel")}:</strong> {selectedReview.orders?.service_date} {t("modal.at")} {selectedReview.orders?.service_time}</p>
              <p><strong>{t("modal.trustLevelLabel")}:</strong> <span className="capitalize">{selectedReview.employees?.trust_level || t("modal.standardTrustLevel")}</span></p>
            </div>

            {selectedReview.photos && selectedReview.photos.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">{t("modal.photoEvidence", { count: selectedReview.photos.length })}</p>
                <div className="grid grid-cols-4 gap-2">
                  {selectedReview.photos.map((photo, idx) => (
                    <button
                      key={`${photo.url}-${idx}`}
                      type="button"
                      onClick={() => setLightboxUrl(photo.url)}
                      className="relative aspect-square rounded-md overflow-hidden border border-gray-200 hover:opacity-80 transition-opacity"
                      title={photo.label}
                    >
                      {/* Item 5 (auditoría 2026-07-25): las fotos vienen de
                          Supabase Storage (dominio dinámico por proyecto, no
                          configurado en next.config.mjs images.remotePatterns),
                          así que se usa `unoptimized` en vez de agregar un
                          remotePattern a ciegas -- sigue dando lazy-loading
                          nativo del navegador y layout estable via `fill`. */}
                      <Image
                        src={photo.url}
                        alt={photo.label || t("photos.altText")}
                        fill
                        unoptimized
                        sizes="(max-width: 768px) 25vw, 150px"
                        className="object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                <Camera className="w-4 h-4" />
                <span>{t("modal.noPhotosForService")}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setReviewStatus("approved")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                  reviewStatus === "approved"
                    ? "bg-green-100 text-green-700 border-2 border-green-300"
                    : "bg-gray-100 text-gray-600 border-2 border-transparent"
                }`}
              >
                <ThumbsUp className="w-4 h-4" />
                {t("modal.approveButton")}
              </button>
              <button
                onClick={() => setReviewStatus("rejected")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                  reviewStatus === "rejected"
                    ? "bg-red-100 text-red-700 border-2 border-red-300"
                    : "bg-gray-100 text-gray-600 border-2 border-transparent"
                }`}
              >
                <ThumbsDown className="w-4 h-4" />
                {t("modal.rejectButton")}
              </button>
            </div>

            <textarea
              aria-label={t("modal.noteAriaLabel")}
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder={t("modal.notePlaceholder")}
              className="w-full border rounded-lg p-3 text-sm min-h-[100px] focus:ring-2 focus:ring-brand-navy focus:border-transparent"
            />

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <button
              onClick={() => submitReview(selectedReview.order_id)}
              disabled={submitting}
              className="w-full bg-brand-navy text-white py-3 rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : t("modal.submitButton")}
            </button>
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {lightboxUrl && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("lightbox.closeAriaLabel")}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300"
            aria-label={t("lightbox.closeButtonAriaLabel")}
          >
            <X className="w-8 h-8" />
          </button>
          <div className="relative w-full h-full max-w-3xl max-h-[85vh]">
            <Image
              src={lightboxUrl}
              alt={t("lightbox.enlargedAltText")}
              fill
              unoptimized
              sizes="90vw"
              className="rounded-lg object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
