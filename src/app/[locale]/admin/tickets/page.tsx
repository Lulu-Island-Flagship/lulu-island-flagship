"use client";

import React, { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  User,
  Calendar,
  XCircle,
} from "lucide-react";

interface Ticket {
  id: string;
  order_id: string | null;
  employee_id: string | null;
  type: string;
  priority: number;
  status: string;
  context: Record<string, unknown>;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  employees: { name: string } | null;
  orders: { service_date: string; service_time: string } | null;
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");

  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionStatus, setResolutionStatus] = useState<"resolved" | "escalated">("resolved");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function loadTickets() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/tickets?status=${statusFilter}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load tickets");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function resolveTicket(ticketId: string) {
    if (!resolutionNote.trim()) {
      setError("Resolution note is required");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ resolutionNote: resolutionNote.trim(), status: resolutionStatus }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to resolve ticket");
        setSubmitting(false);
        return;
      }
      setSelectedTicket(null);
      setResolutionNote("");
      loadTickets();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const getPriorityLabel = (priority: number) => {
    if (priority >= 5) return { label: "Critical", color: "bg-red-100 text-red-700" };
    if (priority >= 4) return { label: "High", color: "bg-orange-100 text-orange-700" };
    if (priority >= 3) return { label: "Medium", color: "bg-yellow-100 text-yellow-700" };
    return { label: "Low", color: "bg-blue-100 text-blue-700" };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return "bg-red-100 text-red-700";
      case "in_review":
        return "bg-yellow-100 text-yellow-700";
      case "resolved":
        return "bg-green-100 text-green-700";
      case "escalated":
        return "bg-purple-100 text-purple-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">Tickets & Disputes</h1>
        <div className="flex gap-2">
          {["open", "in_review", "resolved", "escalated"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s
                  ? "bg-brand-navy text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : error && !selectedTicket ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">No tickets with status &quot;{statusFilter.replace(/_/g, " ")}&quot;.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => {
            const priority = getPriorityLabel(ticket.priority);
            return (
              <div
                key={ticket.id}
                className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${priority.color}`}>
                        {priority.label}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getStatusBadge(ticket.status)}`}>
                        {ticket.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                      </span>
                      <span className="text-xs text-gray-400 capitalize">
                        {ticket.type.replace(/_/g, " ")}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-brand-ink">
                      <User className="w-4 h-4 text-gray-400" />
                      <span>{ticket.employees?.name || "System"}</span>
                    </div>

                    {ticket.orders && (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span>{ticket.orders.service_date} at {ticket.orders.service_time}</span>
                      </div>
                    )}

                    {ticket.context && typeof ticket.context === "object" && "description" in ticket.context && (
                      <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2">
                        {String(ticket.context.description)}
                      </p>
                    )}

                    {ticket.resolution_note && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                        <p className="text-sm text-green-700">
                          <strong>Resolution:</strong> {ticket.resolution_note}
                        </p>
                        {ticket.resolved_at && (
                          <p className="text-xs text-green-500 mt-1">
                            Resolved {new Date(ticket.resolved_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {ticket.status === "open" || ticket.status === "in_review" ? (
                    <button
                      onClick={() => {
                        setSelectedTicket(ticket);
                        setResolutionNote("");
                        setResolutionStatus("resolved");
                        setError("");
                      }}
                      className="bg-brand-navy text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors ml-2"
                    >
                      Resolve
                    </button>
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-green-400 ml-2" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resolve Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-brand-ink">Resolve Ticket</h2>
              <button
                onClick={() => setSelectedTicket(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm space-y-1">
              <p><strong>Type:</strong> {selectedTicket.type.replace(/_/g, " ")}</p>
              <p><strong>Priority:</strong> {getPriorityLabel(selectedTicket.priority).label}</p>
              {selectedTicket.employees?.name && (
                <p><strong>Employee:</strong> {selectedTicket.employees.name}</p>
              )}
              {selectedTicket.context && typeof selectedTicket.context === "object" && "description" in selectedTicket.context && (
                <p className="text-gray-600 bg-gray-50 rounded-lg p-2 mt-2">
                  {String(selectedTicket.context.description)}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setResolutionStatus("resolved")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                  resolutionStatus === "resolved"
                    ? "bg-green-100 text-green-700 border-2 border-green-300"
                    : "bg-gray-100 text-gray-600 border-2 border-transparent"
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                Resolve
              </button>
              <button
                onClick={() => setResolutionStatus("escalated")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                  resolutionStatus === "escalated"
                    ? "bg-purple-100 text-purple-700 border-2 border-purple-300"
                    : "bg-gray-100 text-gray-600 border-2 border-transparent"
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                Escalate
              </button>
            </div>

            <textarea
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="Resolution note (required)..."
              className="w-full border rounded-lg p-3 text-sm min-h-[100px] focus:ring-2 focus:ring-brand-navy focus:border-transparent"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={() => resolveTicket(selectedTicket.id)}
              disabled={submitting}
              className="w-full bg-brand-navy text-white py-3 rounded-lg font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit Resolution"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
