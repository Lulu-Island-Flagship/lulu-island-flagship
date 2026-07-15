"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  Calendar,
  MapPin,
  ChevronDown,
  Flag,
  CheckCircle2,
  Clock,
  Camera,
  X,
  Repeat,
  Images,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface ClaimableZone {
  zone: string;
  zoneLabel: string;
}

interface ClientOrder {
  id: string;
  service_date: string;
  service_time: string;
  status: string;
  total_paid: number;
  warranty_status: string;
  quotes: { service_category?: string; service_subtype?: string; address?: string; zone?: string } | null;
  claimableZones: ClaimableZone[];
}

interface WarrantyClaim {
  id: string;
  order_id: string;
  claim_zone: string;
  reason: string;
  status: string;
  opened_at: string;
  resolved_at: string | null;
  final_action: string | null;
  resolution_notes: string | null;
}

const FINAL_ACTION_LABEL: Record<string, string> = {
  free_recleaning: "Free re-cleaning scheduled",
  explain_no_action: "Reviewed — closure photo shown, no action needed",
  dismiss: "Dismissed",
};

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-green-50 text-green-700",
  confirmed: "bg-blue-50 text-blue-700",
  cancelled: "bg-gray-100 text-gray-500",
  no_show: "bg-red-50 text-red-600",
  pending: "bg-amber-50 text-amber-700",
};

export default function MisServiciosClient() {
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimingOrderId, setClaimingOrderId] = useState<string | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [ordersRes, claimsRes] = await Promise.all([
        fetch("/api/client/orders", { credentials: "include" }),
        fetch("/api/client/warranty-claims", { credentials: "include" }),
      ]);
      if (!ordersRes.ok) {
        const err = await ordersRes.json();
        setError(err.error || "Failed to load services");
        return;
      }
      const ordersData = await ordersRes.json();
      setOrders(ordersData.orders || []);

      if (claimsRes.ok) {
        const claimsData = await claimsRes.json();
        setClaims(claimsData.claims || []);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
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
      <div className="text-center">
        <h1 className="text-3xl font-bold text-brand-ink mb-2">My Services</h1>
        <p className="text-gray-600">Your service history. Report an issue within a completed service if something wasn&apos;t right.</p>
        <div className="flex items-center justify-center gap-3 mt-2">
          <a href="../propiedades" className="text-xs text-brand-wave-blue hover:text-brand-navy underline">
            Manage my properties
          </a>
          <a href="../billetera" className="text-xs text-brand-wave-blue hover:text-brand-navy underline">
            Lulu Wallet
          </a>
          <a href="../referidos" className="text-xs text-brand-wave-blue hover:text-brand-navy underline">
            Refer a friend
          </a>
        </div>
      </div>

      <NextRecurringVisitCard />
      <LivePortfolioNotice />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">No services yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const orderClaims = claims.filter((c) => c.order_id === order.id);
            const claimedZones = new Set(orderClaims.filter((c) => c.status === "open").map((c) => c.claim_zone));
            return (
              <div key={order.id} className="bg-white rounded-xl border overflow-hidden">
                <div className="p-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-brand-ink">
                        {order.quotes?.service_subtype || "Cleaning service"}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[order.status] || "bg-gray-100 text-gray-600"}`}>
                        {order.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {order.service_date} · {order.service_time}
                    </div>
                    {order.quotes?.address && (
                      <div className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                        <MapPin className="w-3 h-3" />
                        {order.quotes.address}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    {order.status === "completed" && (
                      <a
                        href={`servicios/${order.id}/galeria`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-navy hover:underline"
                      >
                        View photos & checklist
                      </a>
                    )}
                    {order.status === "completed" && order.claimableZones.length > 0 && (
                      <button
                        onClick={() => setClaimingOrderId(claimingOrderId === order.id ? null : order.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-wave-blue hover:text-brand-navy border border-brand-wave-blue/30 rounded-lg px-3 py-1.5"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        Report an issue
                        <ChevronDown className={`w-3 h-3 transition-transform ${claimingOrderId === order.id ? "rotate-180" : ""}`} />
                      </button>
                    )}
                  </div>
                </div>

                {orderClaims.length > 0 && (
                  <div className="px-4 pb-3 space-y-2">
                    {orderClaims.map((claim) => (
                      <div key={claim.id} className="bg-gray-50 rounded-lg p-3 text-xs">
                        <div className="flex items-center gap-2">
                          {claim.status === "open" ? (
                            <Clock className="w-3.5 h-3.5 text-state-warning" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-state-success" />
                          )}
                          <span className="font-medium text-brand-ink">{claim.claim_zone}</span>
                          <span className="text-gray-400">— {claim.reason}</span>
                        </div>
                        {claim.final_action && (
                          <p className="mt-1 text-gray-600">{FINAL_ACTION_LABEL[claim.final_action] || claim.final_action}</p>
                        )}
                        {claim.status === "open" && !claim.final_action && (
                          <p className="mt-1 text-gray-500">Under review.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {claimingOrderId === order.id && (
                  <ClaimForm
                    order={order}
                    alreadyClaimedZones={claimedZones}
                    onSubmitted={() => {
                      setClaimingOrderId(null);
                      loadAll();
                    }}
                    onCancel={() => setClaimingOrderId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClaimForm({
  order,
  alreadyClaimedZones,
  onSubmitted,
  onCancel,
}: {
  order: ClientOrder;
  alreadyClaimedZones: Set<string>;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const availableZones = order.claimableZones.filter((z) => !alreadyClaimedZones.has(z.zone));
  const [zone, setZone] = useState(availableZones[0]?.zone || "");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!zone) {
      setFormError("Select a zone");
      return;
    }
    if (reason.trim().length < 3) {
      setFormError("Please describe the issue (at least a few words)");
      return;
    }

    setSubmitting(true);
    setFormError("");

    try {
      let photoUrls: string[] = [];
      if (photoFile) {
        const fileExt = photoFile.name.split(".").pop() || "jpg";
        const fileName = `${order.id}/warranty-evidence/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("service-photos")
          .upload(fileName, photoFile, { contentType: photoFile.type });
        if (uploadError) {
          setFormError("Failed to upload photo, please try again.");
          setSubmitting(false);
          return;
        }
        const { data: publicUrlData } = supabase.storage.from("service-photos").getPublicUrl(fileName);
        photoUrls = [publicUrlData.publicUrl];
      }

      const res = await fetch("/api/client/warranty-claims", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          claimZone: zone,
          reason: reason.trim(),
          description: description.trim() || undefined,
          photoUrls,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setFormError(err.error || "Failed to submit");
        return;
      }

      onSubmitted();
    } catch {
      setFormError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (availableZones.length === 0) {
    return (
      <div className="px-4 pb-4 text-xs text-gray-500">
        All zones for this service already have an open claim.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-1 border-t space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">Which area?</label>
        <div className="flex flex-wrap gap-2">
          {availableZones.map((z) => (
            <button
              type="button"
              key={z.zone}
              onClick={() => setZone(z.zone)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                zone === z.zone
                  ? "border-brand-gold bg-brand-gold/10 font-medium"
                  : "border-gray-200 hover:border-brand-wave-blue"
              }`}
            >
              {z.zoneLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">What happened?</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Bathroom mirror still had smudges"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">More detail (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" />
          Photo (optional, helps us review faster)
        </label>
        {photoFile ? (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            {photoFile.name}
            <button type="button" onClick={() => setPhotoFile(null)} className="text-gray-400 hover:text-red-500">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
            className="text-xs"
          />
        )}
      </div>

      {formError && <p className="text-xs text-state-danger">{formError}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
        >
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Submit
        </button>
      </div>
    </form>
  );
}

/**
 * v8.3 E5.12 — "Recurrente de un toque": si el cliente tiene un contrato de
 * servicio recurrente activo, un solo botón encadena GET next-visit + POST
 * /api/quote + redirect al checkout existente. Nada se muestra si no hay
 * contrato activo (no molesta a clientes no recurrentes).
 */
function NextRecurringVisitCard() {
  const router = useRouter();
  const [hasContract, setHasContract] = useState<boolean | null>(null);
  const [nextDate, setNextDate] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/client/contracts/next-visit", { credentials: "include" });
        if (!res.ok) {
          setHasContract(false);
          return;
        }
        const json = await res.json();
        setHasContract(Boolean(json.hasActiveContract && json.prefill));
        setNextDate(json.nextDate || null);
      } catch {
        setHasContract(false);
      }
    })();
  }, []);

  async function bookNextVisit() {
    setBooking(true);
    setBookError("");
    try {
      const infoRes = await fetch("/api/client/contracts/next-visit", { credentials: "include" });
      const info = await infoRes.json();
      if (!infoRes.ok || !info.prefill) {
        setBookError(info.error || "Could not load your recurring plan");
        return;
      }
      const day = new Date(`${info.nextDate}T12:00:00Z`).getUTCDay();
      const quoteRes = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...info.prefill, dayOfWeek: day, isPreferredDay: true }),
      });
      const quoteJson = await quoteRes.json();
      if (!quoteRes.ok) {
        setBookError(quoteJson.error || "Could not create quote");
        return;
      }
      const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en";
      const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
      router.push(`/${safeLocale}/reserva/${quoteJson.quoteId}?date=${info.nextDate}`);
    } catch {
      setBookError("Network error");
    } finally {
      setBooking(false);
    }
  }

  if (!hasContract) return null;

  return (
    <div className="bg-brand-ice border border-brand-gold/30 rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-sm text-brand-ink">
        <Repeat className="w-4 h-4 text-brand-gold-dark shrink-0" />
        <span>
          Your recurring plan{nextDate ? ` — next visit ${nextDate}` : ""}
        </span>
      </div>
      <button
        onClick={bookNextVisit}
        disabled={booking}
        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-navy text-white px-4 py-2 rounded-lg disabled:opacity-50"
      >
        {booking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Book next visit"}
      </button>
      {bookError && <p className="text-xs text-state-danger">{bookError}</p>}
    </div>
  );
}

interface LivePortfolioEntry {
  id: string;
  anonymous_label: string;
  status: string;
  canWithdraw: boolean;
  withdrawal_deadline: string | null;
}

/**
 * v8.3 E5.15 — "Derecho de retiro <24h": si uno de los servicios del
 * cliente fue aprobado para el Live Portfolio (siempre requiere su
 * consentimiento de fotos de marketing previo), se le avisa aquí y puede
 * retirarlo mientras la ventana de 24h siga abierta.
 */
function LivePortfolioNotice() {
  const [entries, setEntries] = useState<LivePortfolioEntry[]>([]);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/client/live-portfolio", { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json();
        setEntries((json.entries || []).filter((e: LivePortfolioEntry) => e.status === "approved"));
      } catch {
        // silencioso -- notificación opcional, no bloquea la página
      }
    })();
  }, []);

  async function withdraw(id: string) {
    setWithdrawing(id);
    setNotice("");
    try {
      const res = await fetch(`/api/client/live-portfolio/${id}/withdraw`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice(json.error || "Could not withdraw");
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setNotice("Removed from Live Portfolio.");
    } catch {
      setNotice("Network error");
    } finally {
      setWithdrawing(null);
    }
  }

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div
          key={e.id}
          className="bg-brand-ice border border-brand-gold/30 rounded-xl p-4 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-2 text-sm text-brand-ink">
            <Images className="w-4 h-4 text-brand-gold-dark shrink-0" />
            <span>One of your services ({e.anonymous_label}) was selected for our Live Portfolio.</span>
          </div>
          {e.canWithdraw && (
            <button
              onClick={() => withdraw(e.id)}
              disabled={withdrawing === e.id}
              className="shrink-0 text-xs font-semibold text-brand-navy border border-brand-navy/30 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {withdrawing === e.id ? "Removing..." : "Remove it"}
            </button>
          )}
        </div>
      ))}
      {notice && <p className="text-xs text-gray-500">{notice}</p>}
    </div>
  );
}
