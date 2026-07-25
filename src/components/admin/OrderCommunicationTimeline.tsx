"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MessageSquare, Check, CheckCheck, Clock, XCircle, PauseCircle } from "lucide-react";

interface CommunicationLogEntry {
  id: string;
  event_key: string;
  category: "transactional" | "marketing";
  channel: string;
  language: string;
  body_rendered: string;
  status: "queued" | "postponed" | "sent" | "delivered" | "read" | "failed";
  postponed_reason: string | null;
  sent_at: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<CommunicationLogEntry["status"], { icon: typeof Check; className: string }> = {
  queued: { icon: Clock, className: "text-gray-400" },
  postponed: { icon: PauseCircle, className: "text-amber-600" },
  sent: { icon: Check, className: "text-brand-wave-blue" },
  delivered: { icon: CheckCheck, className: "text-brand-wave-blue" },
  read: { icon: CheckCheck, className: "text-state-success" },
  failed: { icon: XCircle, className: "text-state-danger" },
};

/** v8.3 E6.3 — timeline cronológico de comunicación de una orden. Pensado para incrustarse en tickets/disputas. */
export default function OrderCommunicationTimeline({ orderId }: { orderId: string }) {
  const t = useTranslations("admin.orderCommunicationTimeline");
  const [entries, setEntries] = useState<CommunicationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/admin/orders/${orderId}/communication-log`, { credentials: "include" });
        if (!res.ok) {
          const err = await res.json();
          if (!cancelled) setError(err.error || t("loadError"));
          return;
        }
        const data = await res.json();
        if (!cancelled) setEntries(data.communicationLog || []);
      } catch {
        if (!cancelled) setError(t("networkError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orderId, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-red-600">{error}</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="text-sm text-gray-500 flex items-center gap-2">
        <MessageSquare className="w-4 h-4" /> {t("empty")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const style = STATUS_STYLE[entry.status];
        const Icon = style.icon;
        return (
          <div key={entry.id} className="border rounded-lg p-3 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium text-brand-ink">
                {entry.event_key} <span className="text-xs text-gray-400 font-normal">({entry.channel})</span>
              </span>
              <span className={`flex items-center gap-1 text-xs font-medium ${style.className}`}>
                <Icon className="w-3.5 h-3.5" /> {t(`status.${entry.status}`)}
              </span>
            </div>
            {entry.body_rendered && <p className="text-xs text-gray-500">{entry.body_rendered}</p>}
            {entry.postponed_reason && <p className="text-xs text-amber-700">{entry.postponed_reason}</p>}
            <p className="text-xs text-gray-400">
              {new Date(entry.created_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
            </p>
          </div>
        );
      })}
    </div>
  );
}
