"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Siren, Clock, CheckCircle2, Inbox } from "lucide-react";

type Tier = "respond_10min" | "can_wait";
type Severity = "p0_safety" | "p1_urgent" | "p2_automatic";
type Status = "open" | "acknowledged" | "resolved" | "auto_resolved";

interface UnifiedAlert {
  id: string;
  source_module: string;
  tier: Tier;
  severity: Severity;
  title: string;
  summary: string | null;
  status: Status;
  created_at: string;
}

const SEVERITY_STYLE: Record<Severity, { label: string; className: string }> = {
  p0_safety: { label: "P0 — Safety", className: "bg-red-50 text-red-700 border-red-200" },
  p1_urgent: { label: "P1 — Urgent", className: "bg-amber-50 text-amber-700 border-amber-200" },
  p2_automatic: { label: "P2 — Automatic", className: "bg-gray-50 text-gray-600 border-gray-200" },
};

export default function UnifiedAlertsInboxPage() {
  const [alerts, setAlerts] = useState<UnifiedAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/alerts", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load");
        return;
      }
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function act(id: string, action: "acknowledge" | "resolve") {
    setActing(id);
    setError("");
    try {
      const res = await fetch("/api/admin/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, id }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed");
        return;
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setActing(null);
    }
  }

  const respondNow = alerts.filter((a) => a.tier === "respond_10min" && a.status !== "resolved");
  const canWait = alerts.filter((a) => a.tier === "can_wait" && a.status !== "resolved");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  function AlertCard({ alert }: { alert: UnifiedAlert }) {
    const style = SEVERITY_STYLE[alert.severity];
    return (
      <div className={`rounded-xl border p-4 space-y-2 ${style.className}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{style.label}</span>
          <span className="text-xs opacity-70">{alert.source_module}</span>
        </div>
        <p className="font-medium text-sm text-brand-ink">{alert.title}</p>
        {alert.summary && <p className="text-xs text-gray-600">{alert.summary}</p>}
        <p className="text-xs text-gray-400">
          {new Date(alert.created_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}
        </p>
        <div className="flex gap-2 pt-1">
          {alert.status === "open" && (
            <button
              onClick={() => act(alert.id, "acknowledge")}
              disabled={acting === alert.id}
              className="text-xs bg-white border px-3 py-1 rounded-lg disabled:opacity-50"
            >
              Acknowledge
            </button>
          )}
          {alert.status !== "resolved" && (
            <button
              onClick={() => act(alert.id, "resolve")}
              disabled={acting === alert.id}
              className="text-xs bg-brand-navy text-white px-3 py-1 rounded-lg disabled:opacity-50"
            >
              Resolve
            </button>
          )}
          {alert.status === "acknowledged" && (
            <span className="text-xs text-gray-500 self-center">Acknowledged</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">Unified Alert Inbox</h1>
        <p className="text-sm text-gray-500 mt-1">
          E0.6 — one queue, two tiers. &quot;Respond in 10 min&quot; alerts trigger Fallback if untouched; &quot;can wait&quot; don&apos;t.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2 flex items-center gap-2">
          <Siren className="w-4 h-4 text-state-danger" /> Respond in 10 min ({respondNow.length})
        </h2>
        {respondNow.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
            <Inbox className="w-6 h-6 text-gray-300 mx-auto mb-1" /> Nothing urgent.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {respondNow.map((a) => (
              <AlertCard key={a.id} alert={a} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-semibold text-brand-ink mb-2 flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" /> Can wait ({canWait.length})
        </h2>
        {canWait.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
            <CheckCircle2 className="w-6 h-6 text-gray-300 mx-auto mb-1" /> Nothing pending.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {canWait.map((a) => (
              <AlertCard key={a.id} alert={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
