"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Scale, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Feed {
  id: string;
  entity_name: string;
  check_frequency: string;
  last_checked_at: string | null;
  last_change_detected_at: string | null;
  isBlind: boolean;
}

interface Alert {
  id: string;
  feed_id: string;
  detected_at: string;
  change_description: string;
  dollar_impact_cents: number | null;
  suggested_actions: string[];
}

/**
 * v8.3 E9.7 — Monitoreo legal dinámico: 7 entes regulatorios, health-check
 * de "ceguera" (30 días sin chequear), y registro manual de cambios
 * detectados mientras no exista scraping real de cada sitio (fuera de
 * alcance, documentado en la propia ruta API). El backend ya existía; esta
 * página cierra el gap de que nadie podía usarlo.
 */
export default function LegalMonitoringPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [changeForm, setChangeForm] = useState<{ feedId: string; description: string; impact: string } | null>(
    null
  );

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/legal-monitoring", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load");
        return;
      }
      setFeeds(data.feeds || []);
      setAlerts(data.openAlerts || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function markChecked(feedId: string, withChange: boolean) {
    setCheckingId(feedId);
    setError("");
    try {
      const body: Record<string, unknown> = { feedId, changeDetected: withChange };
      if (withChange && changeForm) {
        body.changeDescription = changeForm.description;
        body.dollarImpactCents = changeForm.impact ? Math.round(parseFloat(changeForm.impact) * 100) : undefined;
      }
      const res = await fetch("/api/admin/legal-monitoring", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update");
        return;
      }
      setChangeForm(null);
      await load();
    } catch {
      setError("Network error");
    } finally {
      setCheckingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  const blindCount = feeds.filter((f) => f.isBlind).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <Scale className="w-6 h-6" /> Legal Monitoring
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          7 regulatory entities, manual check-in per their frequency. A feed unchecked for 30+ days is
          &quot;blind&quot; and needs attention.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {blindCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {blindCount} feed(s) are blind — legal monitoring is not current.
        </div>
      )}

      {alerts.length > 0 && (
        <div>
          <h2 className="font-semibold text-brand-ink mb-2">Open legal change alerts</h2>
          <div className="bg-white rounded-xl border divide-y">
            {alerts.map((a) => (
              <div key={a.id} className="p-3 text-sm">
                <p className="text-brand-ink">{a.change_description}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Detected {new Date(a.detected_at).toLocaleDateString()}
                  {a.dollar_impact_cents !== null && ` — impact $${(a.dollar_impact_cents / 100).toFixed(2)}`}
                </p>
                {a.suggested_actions.length > 0 && (
                  <ul className="mt-1 list-disc list-inside text-xs text-gray-500">
                    {a.suggested_actions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">Feeds</h2>
        <div className="bg-white rounded-xl border divide-y">
          {feeds.map((f) => (
            <div key={f.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-brand-ink text-sm flex items-center gap-2">
                    {f.entity_name}
                    {f.isBlind && <AlertTriangle className="w-3.5 h-3.5 text-state-danger" />}
                  </p>
                  <p className="text-xs text-gray-500">
                    {f.check_frequency} · last checked{" "}
                    {f.last_checked_at ? new Date(f.last_checked_at).toLocaleDateString() : "never"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => markChecked(f.id, false)}
                    disabled={checkingId === f.id}
                    className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-navy text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> No change
                  </button>
                  <button
                    onClick={() =>
                      setChangeForm(
                        changeForm?.feedId === f.id ? null : { feedId: f.id, description: "", impact: "" }
                      )
                    }
                    className="text-xs font-medium text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg"
                  >
                    Log change
                  </button>
                </div>
              </div>

              {changeForm?.feedId === f.id && (
                <div className="space-y-2 pt-2 border-t">
                  <input
                    type="text"
                    value={changeForm.description}
                    onChange={(e) => setChangeForm({ ...changeForm, description: e.target.value })}
                    placeholder="What changed?"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={changeForm.impact}
                    onChange={(e) => setChangeForm({ ...changeForm, impact: e.target.value })}
                    placeholder="Dollar impact (optional)"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => markChecked(f.id, true)}
                    disabled={checkingId === f.id || changeForm.description.trim().length === 0}
                    className="w-full bg-state-danger text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    Log this change
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
