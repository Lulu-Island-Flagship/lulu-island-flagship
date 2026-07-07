"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Shield,
  Loader2,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

interface QCReview {
  id: string;
  order_id: string;
  employee_id: string;
  status: "pending" | "approved" | "rejected" | "auto";
  note: string | null;
  reviewed_at: string | null;
  created_at: string;
  orders: { service_date: string; service_time: string } | null;
  employees: { name: string; trust_level: string } | null;
}

export default function AdminQCPage() {
  const router = useRouter();
  const [safeLocale, setSafeLocale] = useState("en");
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [reviews, setReviews] = useState<QCReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReview, setSelectedReview] = useState<QCReview | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Extract locale from pathname
    const pathLocale = window.location.pathname.split("/")[1];
    if (["en", "zh", "fr"].includes(pathLocale)) {
      setSafeLocale(pathLocale);
    }
    loadReviews();
  }, [statusFilter]);

  async function loadReviews() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/qc?status=${statusFilter}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/en/admin");
        }
        return;
      }
      const data = await res.json();
      setReviews(data.reviews || []);
    } catch (e) {
      console.error("Load QC error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function submitReview(status: "approved" | "rejected") {
    if (!selectedReview) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/qc/${selectedReview.order_id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status, note: reviewNote }),
      });

      if (res.ok) {
        setSelectedReview(null);
        setReviewNote("");
        await loadReviews();
      }
    } catch (e) {
      console.error("Submit review error:", e);
    } finally {
      setIsSubmitting(false);
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <span className="bg-state-success/10 text-state-success text-xs px-2 py-1 rounded-full font-medium">Approved</span>;
      case "rejected":
        return <span className="bg-state-danger/10 text-state-danger text-xs px-2 py-1 rounded-full font-medium">Rejected</span>;
      case "auto":
        return <span className="bg-brand-navy/10 text-brand-navy text-xs px-2 py-1 rounded-full font-medium">Auto-Approved</span>;
      default:
        return <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-1 rounded-full font-medium">Pending</span>;
    }
  };

  const getTrustBadge = (level: string) => {
    switch (level) {
      case "elite":
        return <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full">Elite</span>;
      case "standard":
        return <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">Standard</span>;
      case "observation":
        return <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">Observation</span>;
      case "suspended":
        return <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">Suspended</span>;
      default:
        return null;
    }
  };

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.push("/en/admin")} className="text-white/70 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-gold" />
            <h1 className="font-semibold">QC Review Wall</h1>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Filter */}
        <div className="flex gap-2 mb-6">
          {["pending", "approved", "rejected", "auto"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s
                  ? "bg-brand-navy text-white"
                  : "bg-white text-gray-600 hover:text-brand-navy"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
          </div>
        ) : (
          <>
            {selectedReview ? (
              <div className="bg-white rounded-xl shadow-elevation-1 p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-brand-ink">QC Review</h2>
                  <button
                    onClick={() => { setSelectedReview(null); setReviewNote(""); }}
                    className="text-sm text-gray-500 hover:text-brand-ink"
                  >
                    Back
                  </button>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
                  <p><span className="font-medium">Order:</span> {selectedReview.order_id.slice(0, 8)}</p>
                  <p><span className="font-medium">Employee:</span> {selectedReview.employees?.name || "Unknown"}</p>
                  <p><span className="font-medium">Trust Level:</span> {getTrustBadge(selectedReview.employees?.trust_level || "")}</p>
                  <p><span className="font-medium">Date:</span> {selectedReview.orders?.service_date} at {selectedReview.orders?.service_time}</p>
                  <p><span className="font-medium">Status:</span> {getStatusBadge(selectedReview.status)}</p>
                  {selectedReview.note && (
                    <p><span className="font-medium">Note:</span> {selectedReview.note}</p>
                  )}
                </div>

                {selectedReview.status === "pending" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-brand-ink mb-2">Review Note (required)</label>
                      <textarea
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                        rows={3}
                        placeholder="Why are you approving or rejecting this service?"
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => submitReview("approved")}
                        disabled={isSubmitting || !reviewNote.trim()}
                        className="flex-1 bg-state-success text-white py-3 rounded-xl font-semibold hover:bg-state-success/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ThumbsUp className="w-5 h-5" />}
                        Approve
                      </button>
                      <button
                        onClick={() => submitReview("rejected")}
                        disabled={isSubmitting || !reviewNote.trim()}
                        className="flex-1 bg-state-danger text-white py-3 rounded-xl font-semibold hover:bg-state-danger/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ThumbsDown className="w-5 h-5" />}
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {selectedReview.status !== "pending" && (
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <CheckCircle2 className="w-8 h-8 text-state-success mx-auto mb-2" />
                    <p className="text-sm text-gray-600">This review has been {selectedReview.status}.</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {reviews.length === 0 ? (
                  <div className="bg-white rounded-xl shadow-elevation-1 p-8 text-center">
                    <CheckCircle2 className="w-10 h-10 text-state-success mx-auto mb-3" />
                    <p className="text-gray-500">No QC reviews in this status.</p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {reviews.map((review) => (
                      <div
                        key={review.id}
                        className="bg-white rounded-xl shadow-elevation-1 p-4 hover:shadow-elevation-2 transition-shadow cursor-pointer"
                        onClick={() => setSelectedReview(review)}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-medium text-brand-ink text-sm">
                              {review.employees?.name || "Unknown"}
                            </p>
                            <p className="text-xs text-gray-400">
                              {review.orders?.service_date}
                            </p>
                          </div>
                          {getStatusBadge(review.status)}
                        </div>

                        <div className="flex items-center gap-2 mb-2">
                          {getTrustBadge(review.employees?.trust_level || "")}
                          {review.status === "auto" && (
                            <span className="text-xs text-gray-400">Elite auto-approval</span>
                          )}
                        </div>

                        <p className="text-xs text-gray-500">
                          <Link href={`/${safeLocale}/admin/servicios/${review.order_id}`} className="text-brand-navy hover:underline">
                            Order: {review.order_id.slice(0, 8)}...
                          </Link>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
