"use client";

import React, { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  User,
  Calendar,
} from "lucide-react";

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
}

export default function QCPage() {
  const [reviews, setReviews] = useState<QCReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [selectedReview, setSelectedReview] = useState<QCReview | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"approved" | "rejected">("approved");
  const [submitting, setSubmitting] = useState(false);

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
        setError(err.error || "Failed to load QC reviews");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setReviews(data.reviews || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function submitReview(orderId: string) {
    if (!reviewNote.trim()) {
      setError("Note is required");
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
        setError(err.error || "Failed to submit review");
        setSubmitting(false);
        return;
      }
      setSelectedReview(null);
      setReviewNote("");
      loadReviews();
    } catch {
      setError("Network error");
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
    if (status === "auto") return "Auto-Approved";
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">QC Wall</h1>
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
              {s === "auto" ? "Auto" : s.charAt(0).toUpperCase() + s.slice(1)}
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
          <p className="text-gray-500">No QC reviews with status &quot;{statusFilter}&quot;.</p>
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
                  <span className="font-medium">{review.employees?.name || "Unknown"}</span>
                  <span className="text-xs text-gray-400 capitalize">
                    ({review.employees?.trust_level || "standard"})
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span>{review.orders?.service_time || "—"}</span>
                </div>
              </div>

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
                  Review
                </button>
              )}

              {review.status !== "pending" && review.reviewed_at && (
                <p className="text-xs text-gray-400 text-center">
                  Reviewed {new Date(review.reviewed_at).toLocaleDateString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Review Modal */}
      {selectedReview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-brand-ink">QC Review</h2>
              <button
                onClick={() => setSelectedReview(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <p><strong>Employee:</strong> {selectedReview.employees?.name}</p>
              <p><strong>Date:</strong> {selectedReview.orders?.service_date} at {selectedReview.orders?.service_time}</p>
              <p><strong>Trust Level:</strong> <span className="capitalize">{selectedReview.employees?.trust_level || "standard"}</span></p>
            </div>

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
                Approve
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
                Reject
              </button>
            </div>

            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Review note (required)..."
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
              {submitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit Review"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
