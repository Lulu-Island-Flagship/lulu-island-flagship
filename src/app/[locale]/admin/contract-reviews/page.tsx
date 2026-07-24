"use client";

import React, { useEffect, useState } from "react";
import { Loader2, FileSignature, AlertTriangle, CheckCircle2 } from "lucide-react";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

interface Review {
  id: string;
  contract_id: string;
  trigger_date: string;
  anniversary_date: string;
  legal_changes_summary: { hasChanges: boolean; count: number; descriptions: string[] };
  status: "pending" | "approved" | "signed" | "dismissed";
  proposed_terms: { frequency: string; basePrice: number; total: number; serviceSubtype: string } | null;
  dismissal_reason: string | null;
  contract: { user_id: string; service_subtype: string; frequency: string; base_price: number; total: number } | null;
}

function formatCad(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

/**
 * v8.3 E9.8 — Contract renewal review. 60 days before each contract's
 * annual anniversary, the system surfaces any legal changes detected
 * since the last review (E9.7 feed). Digital signature here is a
 * clickwrap (typed name + IP + timestamp) captured by the admin during
 * the renewal call — no real DocuSign/Documenso integration exists in
 * this environment.
 */
export default function ContractReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // 2026-07-24 fix: reemplaza los dos window.prompt() de esta página
  // (razón de descarte y firma digital por nombre escrito) por
  // ConfirmActionModal. Cada uno guarda el id de la revisión pendiente.
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/contract-reviews", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setReviews(data.reviews || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function act(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/contract-reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(message);
      // 2026-07-24 fix: re-lanzar para que ConfirmActionModal (dismiss/sign)
      // pueda mostrar el error dentro del propio modal y mantenerlo abierto
      // para reintentar. El botón "Approve" (fire-and-forget) atrapa este
      // throw por su cuenta más abajo -- el error ya quedó en `error`.
      throw err;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <FileSignature className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Contract Renewal Reviews</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Triggered 60 days before each recurring contract&apos;s annual anniversary. Approve the
        proposed terms, then capture the client&apos;s signature (typed name — clickwrap, same as
        the original quote consent) to supersede the previous version.
      </p>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div key={r.id} className="bg-white rounded border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">
                  Contract {r.contract_id.slice(0, 8)}… · anniversary {r.anniversary_date}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    r.status === "pending"
                      ? "bg-amber-50 text-amber-700"
                      : r.status === "signed"
                        ? "bg-green-50 text-green-700"
                        : r.status === "dismissed"
                          ? "bg-gray-100 text-gray-500"
                          : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {r.status}
                </span>
              </div>

              {r.legal_changes_summary?.hasChanges ? (
                <div className="mb-2 flex items-start gap-2 text-xs text-amber-700">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{r.legal_changes_summary.descriptions.join("; ")}</span>
                </div>
              ) : (
                <div className="mb-2 text-xs text-gray-400">No legal changes detected since last review.</div>
              )}

              {r.proposed_terms && (
                <div className="text-xs text-gray-500 mb-3">
                  Proposed: {r.proposed_terms.frequency} · {r.proposed_terms.serviceSubtype} ·{" "}
                  {formatCad(r.proposed_terms.total)}
                </div>
              )}

              {r.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    disabled={busyId === r.id}
                    onClick={() => {
                      act(r.id, { action: "approve" }).catch(() => {
                        /* error already surfaced via the page-level `error` state */
                      });
                    }}
                    className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => setDismissingId(r.id)}
                    className="text-xs border px-3 py-1.5 rounded"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {r.status === "approved" && (
                <button
                  disabled={busyId === r.id}
                  onClick={() => setSigningId(r.id)}
                  className="text-xs bg-green-700 text-white px-3 py-1.5 rounded flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" /> Capture signature
                </button>
              )}

              {r.status === "dismissed" && r.dismissal_reason && (
                <div className="text-xs text-gray-400">Dismissed: {r.dismissal_reason}</div>
              )}
            </div>
          ))}
          {reviews.length === 0 && <div className="text-sm text-gray-400">No reviews triggered yet.</div>}
        </div>
      )}

      {dismissingId && (
        <ConfirmActionModal
          title="Dismiss this review"
          message="The renewal review will be marked as dismissed and the proposed terms will not be applied."
          confirmLabel="Dismiss"
          danger
          fields={[{ key: "reason", label: "Reason for dismissing this review", autoFocus: true }]}
          onCancel={() => setDismissingId(null)}
          onConfirm={async (values) => {
            await act(dismissingId, { action: "dismiss", reason: values.reason });
            setDismissingId(null);
          }}
        />
      )}

      {signingId && (
        <ConfirmActionModal
          title="Capture client signature"
          message="Read the proposed terms to the client and type the full name exactly as they say it, on the call."
          noticeText="Typing the client's full name here constitutes a digital signature (clickwrap: typed name + IP + timestamp are recorded), the same as the original quote consent. This supersedes the previous contract version once submitted."
          confirmLabel="Capture signature"
          fields={[
            {
              key: "signedByName",
              label: "Client's typed full name (digital signature)",
              placeholder: "Full legal name",
              autoFocus: true,
            },
          ]}
          onCancel={() => setSigningId(null)}
          onConfirm={async (values) => {
            await act(signingId, { action: "sign", signedByName: values.signedByName });
            setSigningId(null);
          }}
        />
      )}
    </div>
  );
}
