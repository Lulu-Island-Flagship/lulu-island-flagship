"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Crown, Users, Clock, AlertTriangle, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

type ClientSegment = "vip" | "regular" | "sporadic" | "at_risk" | "new";

interface SegmentedClient {
  userId: string;
  totalServicesCount: number;
  monthlySpendCents: number;
  daysSinceLastService: number | null;
  segment: ClientSegment;
}

const SEGMENT_META: Record<ClientSegment, { key: string; icon: typeof Crown; className: string }> = {
  vip: { key: "vip", icon: Crown, className: "bg-brand-gold/10 text-brand-gold-dark" },
  regular: { key: "regular", icon: Users, className: "bg-blue-50 text-blue-600" },
  sporadic: { key: "sporadic", icon: Clock, className: "bg-gray-100 text-gray-600" },
  at_risk: { key: "atRisk", icon: AlertTriangle, className: "bg-red-50 text-red-600" },
  new: { key: "new", icon: Sparkles, className: "bg-emerald-50 text-emerald-600" },
};

export default function ClientSegmentsPage() {
  const t = useTranslations("admin.clientSegments");
  const [clients, setClients] = useState<SegmentedClient[]>([]);
  const [counts, setCounts] = useState<Record<ClientSegment, number> | null>(null);
  const [filter, setFilter] = useState<ClientSegment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/client-segments", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setClients(data.clients || []);
      setCounts(data.counts || null);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  const visibleClients = filter ? clients.filter((c) => c.segment === filter) : clients;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {counts && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(Object.keys(SEGMENT_META) as ClientSegment[]).map((seg) => {
            const meta = SEGMENT_META[seg];
            const Icon = meta.icon;
            return (
              <button
                key={seg}
                onClick={() => setFilter(filter === seg ? null : seg)}
                className={`rounded-xl border p-4 text-left transition-shadow hover:shadow-md ${filter === seg ? "ring-2 ring-brand-navy" : ""}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${meta.className}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <p className="text-xl font-bold text-brand-ink">{counts[seg]}</p>
                <p className="text-xs text-gray-500">{t(`segments.${meta.key}`)}</p>
              </button>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-xl border divide-y">
        {visibleClients.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">{t("emptyState")}</div>
        ) : (
          visibleClients.map((c) => {
            const meta = SEGMENT_META[c.segment];
            const Icon = meta.icon;
            return (
              <div key={c.userId} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="text-brand-ink font-mono text-xs">{c.userId}</p>
                  <p className="text-xs text-gray-500">
                    {t("clientRow.services", { count: c.totalServicesCount, spend: (c.monthlySpendCents / 100).toFixed(2) })}
                    {c.daysSinceLastService !== null && ` · ${t("clientRow.daysSinceLastService", { days: c.daysSinceLastService })}`}
                  </p>
                </div>
                <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${meta.className}`}>
                  <Icon className="w-3 h-3" /> {t(`segments.${meta.key}`)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
