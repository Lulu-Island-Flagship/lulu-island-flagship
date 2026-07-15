"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { AlertCircle, Loader2, CheckCircle2, Upload } from "lucide-react";

interface SickLeaveRequest {
  id: string;
  absence_date: string;
  reason_type: "self_reported" | "medical_note";
  reason_text: string;
  pay_type: "paid" | "unpaid_protected" | "discretionary";
  eligibility_reason: string;
  paid_amount_cents: number | null;
}

const PAY_TYPE_LABEL: Record<string, string> = {
  paid: "Paid day",
  unpaid_protected: "Unpaid — job protected",
  discretionary: "Discretionary (employer decides)",
};

function formatCad(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

/**
 * v8.3 (BC ESA Parte 5.1) — Reportar un día de enfermedad. El empleado
 * puede escribir una excusa simple ("tengo gripa") O adjuntar una nota
 * médica -- ninguna de las dos es obligatoria sobre la otra.
 */
export default function EnfermedadPage() {
  const [requests, setRequests] = useState<SickLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [absenceDate, setAbsenceDate] = useState(new Date().toISOString().slice(0, 10));
  const [reasonType, setReasonType] = useState<"self_reported" | "medical_note">("self_reported");
  const [reasonText, setReasonText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/empleado/sick-leave", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setRequests(data.requests || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!reasonText.trim()) {
      setError("Please write a short reason (e.g. 'I have a cold').");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      let documentPath: string | undefined;

      if (reasonType === "medical_note" && file) {
        setUploadingFile(true);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");
        const { data: employee } = await supabase
          .from("employees")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!employee) throw new Error("No employee record found");

        const ext = file.name.split(".").pop() || "pdf";
        const path = `${employee.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("sick-notes").upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
        if (uploadError) throw uploadError;
        documentPath = path;
        setUploadingFile(false);
      }

      const res = await fetch("/api/empleado/sick-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ absenceDate, reasonType, reasonText: reasonText.trim(), documentPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      setSuccess(`Reported — ${PAY_TYPE_LABEL[data.request.pay_type]}.`);
      setReasonText("");
      setFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
      setUploadingFile(false);
    }
  }

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-6 h-6 text-state-warning" />
        <h1 className="text-xl font-bold text-brand-ink">Report a Sick Day</h1>
      </div>
      <p className="text-sm text-gray-500">
        Write a short reason, or attach a medical note if you have one — either is fine. Under BC
        law you get 5 paid sick days and 3 additional unpaid (job-protected) days per calendar
        year, once you&apos;ve been employed 90+ days.
      </p>

      {error && <div className="text-red-600 text-sm">{error}</div>}
      {success && (
        <div className="flex items-center gap-2 text-state-success text-sm">
          <CheckCircle2 className="w-4 h-4" /> {success}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3">
        <div>
          <label className="text-xs text-gray-500">Date</label>
          <input
            type="date"
            value={absenceDate}
            onChange={(e) => setAbsenceDate(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-sm mt-1"
          />
        </div>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={reasonType === "self_reported"}
              onChange={() => setReasonType("self_reported")}
            />
            Simple reason
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={reasonType === "medical_note"}
              onChange={() => setReasonType("medical_note")}
            />
            Medical note
          </label>
        </div>

        <div>
          <label className="text-xs text-gray-500">Reason</label>
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="e.g. I have a cold"
            className="w-full border rounded px-2 py-1.5 text-sm mt-1"
            rows={2}
          />
        </div>

        {reasonType === "medical_note" && (
          <div>
            <label className="text-xs text-gray-500 flex items-center gap-1">
              <Upload className="w-3 h-3" /> Attach note (optional)
            </label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm mt-1"
            />
          </div>
        )}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full bg-brand-navy text-white rounded py-2 text-sm flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {uploadingFile ? "Uploading…" : "Submit"}
        </button>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-brand-ink mb-2">This year</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="bg-white rounded-lg shadow-elevation-1 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.absence_date}</span>
                  <span className="text-xs text-gray-500">{PAY_TYPE_LABEL[r.pay_type]}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{r.reason_text}</div>
                {r.paid_amount_cents !== null && (
                  <div className="text-xs text-brand-navy mt-0.5">{formatCad(r.paid_amount_cents)}</div>
                )}
              </div>
            ))}
            {requests.length === 0 && <div className="text-xs text-gray-400">No sick days reported this year.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
