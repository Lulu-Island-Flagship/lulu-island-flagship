"use client";

import React, { useEffect, useState } from "react";
import { Loader2, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";

interface DsRequest {
  id: string;
  client_user_id: string;
  request_type: "access" | "correction" | "deletion";
  status: "pending" | "processing" | "completed" | "denied";
  requested_at: string;
  due_at: string;
  overdue: boolean;
  correction_details: string | null;
}

interface BreachIncident {
  id: string;
  detected_at: string;
  description: string;
  severity: string;
  oipc_notified_at: string | null;
  affected_notified_at: string | null;
  notification_due_at: string;
  notificationOverdue: boolean;
  status: string;
}

/**
 * v8.3 E9.9 — PIPEDA operativo: los tres derechos del sujeto de datos
 * (acceso/corrección/eliminación) + protocolo de brecha (OIPC BC + 72h).
 * El backend ya existía (src/app/api/admin/pipeda/**); esta página cierra
 * el gap de que nadie podía usarlo.
 */
export default function PipedaPage() {
  const [requests, setRequests] = useState<DsRequest[]>([]);
  const [incidents, setIncidents] = useState<BreachIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newRequest, setNewRequest] = useState({ clientUserId: "", requestType: "access", correctionDetails: "" });
  const [newIncident, setNewIncident] = useState({ description: "", severity: "unknown" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [reqRes, incRes] = await Promise.all([
        fetch("/api/admin/pipeda/requests", { credentials: "include" }),
        fetch("/api/admin/pipeda/breach-incidents", { credentials: "include" }),
      ]);
      const reqData = await reqRes.json();
      const incData = await incRes.json();
      if (reqRes.ok) setRequests(reqData.requests || []);
      if (incRes.ok) setIncidents(incData.incidents || []);
      if (!reqRes.ok || !incRes.ok) setError(reqData.error || incData.error || "Failed to load");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function createRequest() {
    if (!newRequest.clientUserId.trim()) return;
    setError("");
    try {
      const res = await fetch("/api/admin/pipeda/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(newRequest),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create");
        return;
      }
      setNewRequest({ clientUserId: "", requestType: "access", correctionDetails: "" });
      await load();
    } catch {
      setError("Network error");
    }
  }

  async function updateRequest(id: string, action: string, extra?: Record<string, string>) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/pipeda/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update");
        return;
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusyId(null);
    }
  }

  async function createIncident() {
    if (!newIncident.description.trim()) return;
    setError("");
    try {
      const res = await fetch("/api/admin/pipeda/breach-incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...newIncident, affectedClientIds: [] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create");
        return;
      }
      setNewIncident({ description: "", severity: "unknown" });
      await load();
    } catch {
      setError("Network error");
    }
  }

  async function updateIncident(id: string, action: string, status?: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/pipeda/breach-incidents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update");
        return;
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <ShieldAlert className="w-6 h-6" /> PIPEDA Compliance
        </h1>
        <p className="text-sm text-gray-500 mt-1">Data subject requests (48h) and breach protocol (72h).</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="space-y-3">
        <h2 className="font-semibold text-brand-ink">Data subject requests</h2>

        <div className="bg-white rounded-xl border p-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              aria-label="ID de usuario del cliente"
              value={newRequest.clientUserId}
              onChange={(e) => setNewRequest({ ...newRequest, clientUserId: e.target.value })}
              placeholder="Client user ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              aria-label="Tipo de solicitud de datos"
              value={newRequest.requestType}
              onChange={(e) => setNewRequest({ ...newRequest, requestType: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="access">Access</option>
              <option value="correction">Correction</option>
              <option value="deletion">Deletion</option>
            </select>
            <button onClick={createRequest} className="bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium">
              Log request
            </button>
          </div>
          {newRequest.requestType === "correction" && (
            <input
              type="text"
              aria-label="Detalles de la corrección solicitada"
              value={newRequest.correctionDetails}
              onChange={(e) => setNewRequest({ ...newRequest, correctionDetails: e.target.value })}
              placeholder="What needs correcting?"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          )}
        </div>

        {requests.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">No requests logged.</div>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {requests.map((r) => (
              <div key={r.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-brand-ink flex items-center gap-2">
                      {r.request_type}
                      {r.overdue && <AlertTriangle className="w-3.5 h-3.5 text-state-danger" />}
                    </p>
                    <p className="text-xs text-gray-500">
                      Due {new Date(r.due_at).toLocaleDateString()} · status {r.status}
                    </p>
                  </div>
                  {r.status === "pending" && (
                    <button
                      onClick={() => updateRequest(r.id, "start_processing")}
                      disabled={busyId === r.id}
                      className="text-xs font-medium bg-brand-navy text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      Start processing
                    </button>
                  )}
                  {r.status === "processing" && r.request_type === "access" && (
                    <button
                      onClick={() => {
                        const ref = window.prompt("Export reference (where the file was placed)");
                        if (ref) updateRequest(r.id, "complete", { exportReference: ref });
                      }}
                      disabled={busyId === r.id}
                      className="text-xs font-medium bg-state-success text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      Complete
                    </button>
                  )}
                  {r.status === "processing" && r.request_type !== "access" && (
                    <button
                      onClick={() => updateRequest(r.id, "complete")}
                      disabled={busyId === r.id}
                      className="text-xs font-medium bg-state-success text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      Complete
                    </button>
                  )}
                  {(r.status === "completed" || r.status === "denied") && (
                    <CheckCircle2 className="w-4 h-4 text-state-success" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-brand-ink">Breach incidents</h2>

        <div className="bg-white rounded-xl border p-4 space-y-2">
          <input
            type="text"
            aria-label="Descripción del incidente de seguridad"
            value={newIncident.description}
            onChange={(e) => setNewIncident({ ...newIncident, description: e.target.value })}
            placeholder="What happened?"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <select
              aria-label="Gravedad del incidente"
              value={newIncident.severity}
              onChange={(e) => setNewIncident({ ...newIncident, severity: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="unknown">Unknown</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button onClick={createIncident} className="bg-state-danger text-white px-4 py-2 rounded-lg text-sm font-medium">
              Log incident (starts 72h clock)
            </button>
          </div>
        </div>

        {incidents.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">No incidents logged.</div>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {incidents.map((inc) => (
              <div key={inc.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-brand-ink flex items-center gap-2">
                      {inc.description}
                      {inc.notificationOverdue && <AlertTriangle className="w-3.5 h-3.5 text-state-danger" />}
                    </p>
                    <p className="text-xs text-gray-500">
                      Severity {inc.severity} · due {new Date(inc.notification_due_at).toLocaleString()} · status{" "}
                      {inc.status}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!inc.oipc_notified_at && (
                    <button
                      onClick={() => updateIncident(inc.id, "notify_oipc")}
                      disabled={busyId === inc.id}
                      className="text-xs font-medium bg-brand-navy text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      Mark OIPC notified
                    </button>
                  )}
                  {!inc.affected_notified_at && (
                    <button
                      onClick={() => updateIncident(inc.id, "notify_affected")}
                      disabled={busyId === inc.id}
                      className="text-xs font-medium bg-brand-navy text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      Mark affected notified
                    </button>
                  )}
                  {inc.status !== "closed" && (
                    <button
                      onClick={() => updateIncident(inc.id, "set_status", "closed")}
                      disabled={busyId === inc.id}
                      className="text-xs font-medium text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
