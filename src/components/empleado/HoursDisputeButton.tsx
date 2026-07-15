"use client";

import React, { useState } from "react";
import { AlertTriangle, X, CheckCircle2 } from "lucide-react";

/**
 * v8.3 ROUND 3 — hallazgo: POST /api/empleado/hours-dispute (FIX-9, RLS
 * arreglado en round 2) nunca tenía ningún botón real en la PWA que lo
 * llamara -- la misma clase de bug que FIX-3 en la ronda 1 (páginas/rutas
 * construidas pero inalcanzables desde el flujo real). Sin este botón, un
 * empleado no tenía ninguna forma de marcar "T incorrecto" salvo pidiéndolo
 * verbalmente al admin, contradiciendo el punto D.3 #7 del plan.
 */
export function HoursDisputeButton({
  orderId,
  eventType,
  eventLabel,
  recordedTimestamp,
}: {
  orderId: string;
  eventType: "jornada_start" | "jornada_end" | "t_in" | "t_start" | "t_out";
  eventLabel: string;
  recordedTimestamp: string;
}) {
  const [open, setOpen] = useState(false);
  const [claimedTime, setClaimedTime] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      setError("Please explain what time it should have been.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const claimedTimestamp = claimedTime
        ? new Date(`${recordedTimestamp.slice(0, 10)}T${claimedTime}:00`).toISOString()
        : recordedTimestamp;
      const res = await fetch("/api/empleado/hours-dispute", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          claimedEventType: eventType,
          claimedTimestamp,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit dispute");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-brand-wave-blue hover:text-brand-navy underline"
      >
        Time wrong?
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-brand-ink flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-state-warning" />
            Dispute "{eventLabel}"
          </h3>
          <button onClick={() => setOpen(false)}>
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {success ? (
          <div className="flex items-center gap-2 text-state-success text-sm py-2">
            <CheckCircle2 className="w-4 h-4" />
            Reported. An admin will resolve this within 24h.
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              This flags the recorded time for admin review — it never changes your pay until an
              admin confirms the correction. A technical failure never counts against you.
            </p>
            <div>
              <label className="text-xs text-gray-600 block mb-1">What time should it have been?</label>
              <input
                type="time"
                value={claimedTime}
                onChange={(e) => setClaimedTime(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">What happened?</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. app was offline, GPS wouldn't confirm, etc."
              />
            </div>
            {error && <p className="text-xs text-state-danger">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="px-3 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !reason.trim()}
                className="px-3 py-2 text-sm rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
              >
                {submitting ? "Sending..." : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
