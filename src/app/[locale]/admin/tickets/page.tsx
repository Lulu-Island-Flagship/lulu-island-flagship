"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Shield,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  ArrowUpCircle,
} from "lucide-react";

interface Ticket {
  id: string;
  order_id: string | null;
  employee_id: string | null;
  type: "dispute" | "discrepancy" | "consulta";
  priority: "high" | "medium" | "low";
  status: "open" | "in_review" | "resolved" | "escalated";
  context: Record<string, unknown>;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  employees: { name: string } | null;
  orders: { service_date: string; service_time: string } | null;
}

export default function AdminTicketsPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolveStatus, setResolveStatus] = useState<"resolved" | "escalated">("resolved");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadTickets();
  }, [statusFilter]);

  async function loadTickets() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/tickets?status=${statusFilter}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/en/admin");
        } else {
          setError("Failed to load tickets");
        }
        return;
      }
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch (e) {
      console.error("Load tickets error:", e);
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function submitResolution() {
    if (!selectedTicket) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/tickets/${selectedTicket.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          resolutionNote: resolutionNote,
          status: resolveStatus,
        }),
      });

      if (res.ok) {
        setSelectedTicket(null);
        setResolutionNote("");
        await loadTickets();
      }
    } catch (e) {
      console.error("Resolve ticket error:", e);
    } finally {
      setIsSubmitting(false);
    }
  }

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "high":
        return <AlertTriangle className="w-4 h-4 text-state-danger" />;
      case "medium":
        return <AlertCircle className="w-4 h-4 text-brand-gold" />;
      default:
        return <Info className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "resolved":
        return <span className="bg-state-success/10 text-state-success text-xs px-2 py-1 rounded-full font-medium">Resolved</span>;
      case "escalated":
        return <span className="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded-full font-medium">Escalated</span>;
      case "in_review":
        return <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full font-medium">In Review</span>;
      default:
        return <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-1 rounded-full font-medium">Open</span>;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "dispute":
        return "Dispute";
      case "discrepancy":
        return "Discrepancy";
      default:
        return "Consultation";
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
            <h1 className="font-semibold">Tickets & Disputes</h1>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Filter */}
        <div className="flex gap-2 mb-6">
          {["open", "in_review", "resolved", "escalated"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s
                  ? "bg-brand-navy text-white"
                  : "bg-white text-gray-600 hover:text-brand-navy"
              }`}
            >
              {s === "in_review" ? "In Review" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 text-sm font-medium">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
          </div>
        ) : (
          <>
            {selectedTicket ? (
              <div className="bg-white rounded-xl shadow-elevation-1 p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-brand-ink">Ticket Detail</h2>
                  <button
                    onClick={() => { setSelectedTicket(null); setResolutionNote(""); }}
                    className="text-sm text-gray-500 hover:text-brand-ink"
                  >
                    Back
                  </button>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    {getPriorityIcon(selectedTicket.priority)}
                    <span className="font-medium">{getTypeLabel(selectedTicket.type)}</span>
                    {getStatusBadge(selectedTicket.status)}
                  </div>
                  <p><span className="font-medium">ID:</span> {selectedTicket.id.slice(0, 8)}</p>
                  <p><span className="font-medium">Employee:</span> {selectedTicket.employees?.name || "N/A"}</p>
                  {selectedTicket.orders && (
                    <p><span className="font-medium">Service:</span> {selectedTicket.orders.service_date} at {selectedTicket.orders.service_time}</p>
                  )}
                  <p><span className="font-medium">Created:</span> {new Date(selectedTicket.created_at).toLocaleString("en-CA")}</p>

                  {selectedTicket.context && Object.keys(selectedTicket.context).length > 0 && (
                    <div className="mt-2 p-2 bg-white rounded border">
                      <p className="font-medium mb-1">Context:</p>
                      <pre className="text-xs text-gray-600 overflow-auto">{JSON.stringify(selectedTicket.context, null, 2)}</pre>
                    </div>
                  )}

                  {selectedTicket.resolution_note && (
                    <div className="mt-2 p-2 bg-state-success/10 rounded border border-state-success/20">
                      <p className="font-medium text-state-success">Resolution:</p>
                      <p className="text-state-success">{selectedTicket.resolution_note}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Resolved at: {selectedTicket.resolved_at ? new Date(selectedTicket.resolved_at).toLocaleString("en-CA") : "N/A"}
                      </p>
                    </div>
                  )}
                </div>

                {selectedTicket.status === "open" || selectedTicket.status === "in_review" ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-brand-ink mb-2">Resolution Note (required)</label>
                      <textarea
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                        rows={4}
                        placeholder="Describe the resolution, justification, or next steps..."
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => { setResolveStatus("resolved"); submitResolution(); }}
                        disabled={isSubmitting || !resolutionNote.trim()}
                        className="flex-1 bg-state-success text-white py-3 rounded-xl font-semibold hover:bg-state-success/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                        Resolve
                      </button>
                      <button
                        onClick={() => { setResolveStatus("escalated"); submitResolution(); }}
                        disabled={isSubmitting || !resolutionNote.trim()}
                        className="flex-1 bg-purple-600 text-white py-3 rounded-xl font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUpCircle className="w-5 h-5" />}
                        Escalate
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <CheckCircle2 className="w-8 h-8 text-state-success mx-auto mb-2" />
                    <p className="text-sm text-gray-600">This ticket is {selectedTicket.status}.</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {tickets.length === 0 ? (
                  <div className="bg-white rounded-xl shadow-elevation-1 p-8 text-center">
                    <CheckCircle2 className="w-10 h-10 text-state-success mx-auto mb-3" />
                    <p className="text-gray-500">No tickets in this status.</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {tickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className="bg-white rounded-xl shadow-elevation-1 p-4 hover:shadow-elevation-2 transition-shadow cursor-pointer"
                        onClick={() => setSelectedTicket(ticket)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getPriorityIcon(ticket.priority)}
                            <span className="font-medium text-brand-ink text-sm">
                              {getTypeLabel(ticket.type)}
                            </span>
                          </div>
                          {getStatusBadge(ticket.status)}
                        </div>

                        <p className="text-sm text-gray-600 mb-1">
                          {ticket.employees?.name || "No employee"}
                          {ticket.orders && ` · ${ticket.orders.service_date}`}
                        </p>

                        <p className="text-xs text-gray-400">
                          {ticket.id.slice(0, 8)} · {new Date(ticket.created_at).toLocaleDateString("en-CA")}
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
