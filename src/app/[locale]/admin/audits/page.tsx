"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Star,
  ClipboardCheck,
  AlertTriangle,
  Loader2,
  Search,
  CheckCircle2,
  Shield,
  User,
  Calendar,
} from "lucide-react";

interface AuditItem {
  id: string;
  order_id: string;
  employee_id: string;
  score: number;
  criteria: Record<string, number>;
  notes: string;
  created_at: string;
  appealed_at: string | null;
  appeal_reason: string | null;
  employees: { name: string } | null;
}

interface PendingOrder {
  id: string;
  service_date: string;
  service_time: string;
  status: string;
  quotes: { address: string; service_type: string } | null;
  assignments: { employee_id: string; status: string }[];
}

interface PeerVoteAggregate {
  count: number;
  avg: number;
}

export default function AdminAuditsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"pending" | "history" | "peers">("pending");
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [peerVotes, setPeerVotes] = useState<Record<string, PeerVoteAggregate>>({});
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<PendingOrder | null>(null);
  const [auditForm, setAuditForm] = useState({
    score: 4,
    criteria: { puntualidad: 4, calidad: 4, actitud: 4, sop: 4 },
    notes: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterEmployee, setFilterEmployee] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/audits", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/en/admin");
        }
        return;
      }
      const data = await res.json();
      setPendingOrders(data.pendingOrders || []);
      setAudits(data.audits || []);
      setPeerVotes(data.peerVoteAggregates || {});
    } catch (e) {
      console.error("Load audits error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function submitAudit() {
    if (!selectedOrder) return;
    setIsSubmitting(true);
    try {
      const employeeId = selectedOrder.assignments?.[0]?.employee_id;
      if (!employeeId) return;

      const res = await fetch("/api/admin/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId: selectedOrder.id,
          employeeId,
          score: auditForm.score,
          criteria: auditForm.criteria,
          notes: auditForm.notes,
        }),
      });

      if (res.ok) {
        setSelectedOrder(null);
        setAuditForm({ score: 4, criteria: { puntualidad: 4, calidad: 4, actitud: 4, sop: 4 }, notes: "" });
        await loadData();
      }
    } catch (e) {
      console.error("Submit audit error:", e);
    } finally {
      setIsSubmitting(false);
    }
  }

  const filteredAudits = filterEmployee
    ? audits.filter((a) => a.employees?.name?.toLowerCase().includes(filterEmployee.toLowerCase()))
    : audits;

  const getStarColor = (score: number) => {
    if (score >= 4) return "text-yellow-400";
    if (score >= 3) return "text-brand-gold";
    return "text-red-400";
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
            <h1 className="font-semibold">Field Audits</h1>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { key: "pending" as const, label: "Pending Audits", icon: ClipboardCheck },
            { key: "history" as const, label: "History", icon: Calendar },
            { key: "peers" as const, label: "Peer Votes", icon: User },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                activeTab === tab.key
                  ? "bg-brand-navy text-white"
                  : "bg-white text-gray-600 hover:text-brand-navy"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
          </div>
        ) : (
          <>
            {/* Pending Audits */}
            {activeTab === "pending" && (
              <div className="space-y-4">
                {selectedOrder ? (
                  <div className="bg-white rounded-xl shadow-elevation-1 p-6 space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-brand-ink">New Audit</h2>
                      <button
                        onClick={() => setSelectedOrder(null)}
                        className="text-sm text-gray-500 hover:text-brand-ink"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
                      <p><span className="font-medium">Order:</span> {selectedOrder.id.slice(0, 8)}</p>
                      <p><span className="font-medium">Date:</span> {selectedOrder.service_date} at {selectedOrder.service_time}</p>
                      <p><span className="font-medium">Address:</span> {selectedOrder.quotes?.address}</p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-brand-ink mb-2">Overall Score (1-5)</label>
                        <div className="flex gap-2">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <button
                              key={s}
                              onClick={() => setAuditForm({ ...auditForm, score: s })}
                              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                                auditForm.score >= s ? "bg-brand-navy text-white" : "bg-gray-100 text-gray-400"
                              }`}
                            >
                              <Star className="w-5 h-5" />
                            </button>
                          ))}
                        </div>
                      </div>

                      {Object.entries(auditForm.criteria).map(([key, value]) => (
                        <div key={key}>
                          <label className="block text-sm font-medium text-brand-ink mb-2 capitalize">
                            {key === "sop" ? "SOP Compliance" : key}
                          </label>
                          <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <button
                                key={s}
                                onClick={() =>
                                  setAuditForm({
                                    ...auditForm,
                                    criteria: { ...auditForm.criteria, [key]: s },
                                  })
                                }
                                className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors ${
                                  value >= s ? "bg-brand-gold text-white" : "bg-gray-100 text-gray-400"
                                }`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}

                      <div>
                        <label className="block text-sm font-medium text-brand-ink mb-2">Notes</label>
                        <textarea
                          value={auditForm.notes}
                          onChange={(e) => setAuditForm({ ...auditForm, notes: e.target.value })}
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                          rows={3}
                          placeholder="Observations..."
                        />
                      </div>

                      <button
                        onClick={submitAudit}
                        disabled={isSubmitting}
                        className="w-full bg-brand-navy text-white py-3 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                      >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit Audit"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {pendingOrders.length === 0 ? (
                      <div className="bg-white rounded-xl shadow-elevation-1 p-8 text-center">
                        <CheckCircle2 className="w-10 h-10 text-state-success mx-auto mb-3" />
                        <p className="text-gray-500">All completed services have been audited.</p>
                      </div>
                    ) : (
                      <div className="grid gap-4">
                        {pendingOrders.map((order) => (
                          <div
                            key={order.id}
                            className="bg-white rounded-xl shadow-elevation-1 p-4 hover:shadow-elevation-2 transition-shadow cursor-pointer"
                            onClick={() => setSelectedOrder(order)}
                          >
                            <div className="flex items-start justify-between">
                              <div className="space-y-1">
                                <p className="font-medium text-brand-ink text-sm">
                                  {order.quotes?.address || "No address"}
                                </p>
                                <p className="text-sm text-gray-500">
                                  {order.service_date} at {order.service_time}
                                </p>
                                <p className="text-xs text-gray-400">
                                  Order: {order.id.slice(0, 8)}
                                </p>
                              </div>
                              <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-1 rounded-full font-medium">
                                Pending Audit
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* History */}
            {activeTab === "history" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 bg-white rounded-lg shadow-elevation-1 px-3 py-2">
                  <Search className="w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={filterEmployee}
                    onChange={(e) => setFilterEmployee(e.target.value)}
                    placeholder="Filter by employee name..."
                    className="flex-1 text-sm outline-none"
                  />
                </div>

                {filteredAudits.length === 0 ? (
                  <div className="bg-white rounded-xl shadow-elevation-1 p-8 text-center">
                    <ClipboardCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No audits found.</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {filteredAudits.map((audit) => (
                      <div key={audit.id} className="bg-white rounded-xl shadow-elevation-1 p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-medium text-brand-ink text-sm">
                              {audit.employees?.name || "Unknown"}
                            </p>
                            <p className="text-xs text-gray-400">
                              {new Date(audit.created_at).toLocaleDateString("en-CA")}
                            </p>
                          </div>
                          <div className={`flex items-center gap-1 ${getStarColor(audit.score)}`}>
                            <Star className="w-4 h-4 fill-current" />
                            <span className="font-bold text-sm">{audit.score}/5</span>
                          </div>
                        </div>

                        {audit.criteria && (
                          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                            {Object.entries(audit.criteria).map(([key, val]) => (
                              <div key={key} className="flex justify-between bg-gray-50 rounded px-2 py-1">
                                <span className="capitalize text-gray-600">{key}</span>
                                <span className="font-medium">{val}/5</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {audit.notes && (
                          <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2">{audit.notes}</p>
                        )}

                        {audit.appealed_at && (
                          <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                            <AlertTriangle className="w-3 h-3 inline mr-1" />
                            Appealed: {audit.appeal_reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Peer Votes */}
            {activeTab === "peers" && (
              <div className="space-y-4">
                {Object.entries(peerVotes).length === 0 ? (
                  <div className="bg-white rounded-xl shadow-elevation-1 p-8 text-center">
                    <User className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No peer votes this week.</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {Object.entries(peerVotes).map(([empId, vote]) => (
                      <div key={empId} className="bg-white rounded-xl shadow-elevation-1 p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-brand-ink text-sm">Employee {empId.slice(0, 8)}</span>
                          <div className="flex items-center gap-1 text-brand-gold">
                            <Star className="w-4 h-4 fill-current" />
                            <span className="font-bold text-sm">{vote.avg.toFixed(1)}</span>
                            <span className="text-xs text-gray-400">({vote.count} votes)</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
