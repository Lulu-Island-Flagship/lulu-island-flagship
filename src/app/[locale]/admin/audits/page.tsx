"use client";

import React, { useState, useEffect } from "react";
import {
  Loader2,
  CheckCircle2,
  Star,
  ClipboardCheck,
  User,
  XCircle,
} from "lucide-react";

interface PendingOrder {
  id: string;
  service_date: string;
  service_time: string;
  status: string;
  quote_id: string;
  quotes: { address: string; service_type: string } | null;
  assignments: { employee_id: string; status: string }[];
}

interface FieldAudit {
  id: string;
  order_id: string;
  employee_id: string;
  score: number;
  criteria: Record<string, number>;
  notes: string;
  created_at: string;
  appealed_at: string | null;
  appeal_reason: string | null;
  appeal_resolved_at: string | null;
  employees: { name: string } | null;
}

interface PeerVoteAggregate {
  count: number;
  avg: number;
  name: string;
}

export default function AuditsPage() {
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [audits, setAudits] = useState<FieldAudit[]>([]);
  const [peerVotes, setPeerVotes] = useState<Record<string, PeerVoteAggregate>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedOrder, setSelectedOrder] = useState<PendingOrder | null>(null);
  const [auditScore, setAuditScore] = useState(80);
  const [auditNotes, setAuditNotes] = useState("");
  const [announceToClient, setAnnounceToClient] = useState(false);
  const [criteria, setCriteria] = useState<Record<string, number>>({
    punctuality: 4,
    thoroughness: 4,
    professionalism: 4,
    client_satisfaction: 4,
    sop_compliance: 5,
  });
  const [submitting, setSubmitting] = useState(false);

  const dispatchProbability = Math.max(0, Math.min(1, (auditScore / 100) * (Object.values(criteria).reduce((a, b) => a + b, 0) / Object.values(criteria).length / 5)));

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/audits", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load audits");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setPendingOrders(data.pendingOrders || []);
      setAudits(data.audits || []);
      setPeerVotes(data.peerVoteAggregates || {});
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function submitAudit() {
    if (!selectedOrder) return;
    setSubmitting(true);
    setError("");
    try {
      const employeeId = selectedOrder.assignments?.[0]?.employee_id;
      if (!employeeId) {
        setError("No employee assigned to this order");
        setSubmitting(false);
        return;
      }
      const res = await fetch("/api/admin/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId: selectedOrder.id,
          employeeId,
          score: auditScore,
          criteria,
          notes: auditNotes.trim() || null,
          announceToClient,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to submit audit");
        setSubmitting(false);
        return;
      }
      setSelectedOrder(null);
      setAuditScore(80);
      setAuditNotes("");
      setCriteria({
        punctuality: 4,
        thoroughness: 4,
        professionalism: 4,
        client_satisfaction: 4,
        sop_compliance: 4,
      });
      loadData();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  function getMovingAverage5(employeeId: string) {
    const employeeAudits = audits
      .filter((a) => a.employee_id === employeeId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);
    if (employeeAudits.length === 0) return null;
    const sum = employeeAudits.reduce((acc, a) => acc + a.score, 0);
    return Math.round(sum / employeeAudits.length);
  }

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-green-600";
    if (score >= 70) return "text-blue-600";
    if (score >= 50) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-brand-ink">Field Audits</h1>

      {/* Pending Audits */}
      <section>
        <h2 className="text-lg font-semibold text-brand-ink mb-4">Pending Audits (Today&apos;s Completed)</h2>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
          </div>
        ) : pendingOrders.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No completed services pending audit for today.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingOrders.map((order) => (
              <div
                key={order.id}
                className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-brand-ink">
                      {order.quotes?.address || "—"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {order.service_date} at {order.service_time}
                    </p>
                    <p className="text-xs text-gray-400 capitalize">
                      {order.quotes?.service_type?.replace(/_/g, " ") || "—"}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedOrder(order);
                      setAuditScore(80);
                      setAuditNotes("");
                      setCriteria({
                        punctuality: 4,
                        thoroughness: 4,
                        professionalism: 4,
                        client_satisfaction: 4,
                        sop_compliance: 4,
                      });
                      setError("");
                    }}
                    className="bg-brand-navy text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
                  >
                    Audit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Audit History */}
      <section>
        <h2 className="text-lg font-semibold text-brand-ink mb-4">Audit History</h2>
        {audits.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center">
            <ClipboardCheck className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No audits recorded yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {audits.map((audit) => (
              <div
                key={audit.id}
                className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-brand-ink">
                        {audit.employees?.name || "Unknown"}
                      </span>
                      <span className={`text-sm font-bold ${getScoreColor(audit.score)}`}>
                        {audit.score}/100
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {new Date(audit.created_at).toLocaleDateString()}
                    </p>
                    {audit.notes && (
                      <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2">{audit.notes}</p>
                    )}
                    {audit.appealed_at && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-sm">
                        <p className="text-amber-700 font-medium">Appealed</p>
                        <p className="text-amber-600 text-xs">{audit.appeal_reason}</p>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">5-week avg</p>
                    <p className={`text-lg font-bold ${getScoreColor(getMovingAverage5(audit.employee_id) || audit.score)}`}>
                      {getMovingAverage5(audit.employee_id) || audit.score}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Peer Votes */}
      <section>
        <h2 className="text-lg font-semibold text-brand-ink mb-4">Peer Vote Aggregates (This Week)</h2>
        {Object.keys(peerVotes).length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center">
            <Star className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No peer votes recorded for this week.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(peerVotes).map(([employeeId, vote]) => (
              <div key={employeeId} className="bg-white rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-brand-ink">{vote.name}</span>
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-brand-gold fill-brand-gold" />
                    <span className="text-sm font-bold">{vote.avg.toFixed(1)}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">{vote.count} votes</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Audit Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-brand-ink">Field Audit</h2>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm space-y-1">
              <p><strong>Address:</strong> {selectedOrder.quotes?.address}</p>
              <p><strong>Date:</strong> {selectedOrder.service_date} at {selectedOrder.service_time}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink">Overall Score</label>
              <input
                aria-label="Puntaje general de la auditoría (0 a 100)"
                type="range"
                min="0"
                max="100"
                value={auditScore}
                onChange={(e) => setAuditScore(Number(e.target.value))}
                className="w-full mt-1"
              />
              <div className="text-center text-lg font-bold text-brand-navy">{auditScore}</div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium text-brand-ink">Criteria (1-5)</label>
              {Object.entries(criteria).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 capitalize">{key.replace(/_/g, " ")}</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setCriteria({ ...criteria, [key]: n })}
                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                          value >= n
                            ? "bg-brand-navy text-white"
                            : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <textarea
              aria-label="Notas de la auditoría de campo"
              value={auditNotes}
              onChange={(e) => setAuditNotes(e.target.value)}
              placeholder="Notes (optional)..."
              className="w-full border rounded-lg p-3 text-sm min-h-[80px] focus:ring-2 focus:ring-brand-navy focus:border-transparent"
            />

            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-brand-ink">Dispatch probability</span>
                <span className={`text-sm font-bold ${dispatchProbability >= 0.8 ? "text-green-600" : dispatchProbability >= 0.5 ? "text-blue-600" : "text-amber-600"}`}>
                  {(dispatchProbability * 100).toFixed(0)}%
                </span>
              </div>
              <label className="flex items-center gap-2 text-sm text-brand-ink cursor-pointer">
                <input
                  aria-label="Anunciar resultado de auditoría al cliente"
                  type="checkbox"
                  checked={announceToClient}
                  onChange={(e) => setAnnounceToClient(e.target.checked)}
                  className="rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
                />
                Announce audit result to client
              </label>
              <p className="text-xs text-gray-500">
                Auto-announcement is enabled when probability is ≥ 80%.
              </p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              aria-label="Enviar auditoría de campo"
              onClick={submitAudit}
              disabled={submitting}
              className="w-full bg-brand-navy text-white py-3 rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit Audit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
