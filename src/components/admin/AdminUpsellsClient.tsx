"use client";

import React, { useState, useEffect } from "react";
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
  const [upsells, setUpsells] = useState<Upsell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);

  useEffect(() => {
    loadUpsells();
  }, []);

  async function loadUpsells() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/upsells", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load upsells");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setUpsells(data.upsells || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function markReviewed(id: string) {
    setReviewing(id);
    try {
      const res = await fetch(`/api/admin/upsells/${id}/review`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setUpsells((prev) => prev.filter((u) => u.id !== id));
      }
    } catch (e) {
      console.error("Review error:", e);
    } finally {
      setReviewing(null);
    }
  }

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

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
        <h1 className="text-2xl font-bold text-brand-ink">Upsells Pending Review</h1>
        <span className="text-sm text-gray-500">
          {upsells.length} pending
        </span>
      </div>

      {upsells.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-2" />
          <p className="text-gray-500">All upsells have been reviewed.</p>
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
                        Client approved
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        Pending client approval
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
                    <span>{u.employees?.name || "Unknown"}</span>
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

              <button
                onClick={() => markReviewed(u.id)}
                disabled={reviewing === u.id}
                className="w-full py-2 bg-brand-navy text-white rounded-lg font-medium text-sm hover:bg-brand-navy/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {reviewing === u.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Mark as Reviewed
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
