"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Loader2,
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
import { StatusBanner } from "./StatusBanner";
import { Skeleton, SkeletonServiceList } from "@/components/ui/Skeleton";
import { AuthModal } from "@/components/cotizador/AuthModal";

interface ClaimableZone {
  zone: string;
  zoneLabel: string;
}

interface ClientOrder {
  id: string;
  service_date: string;
  service_time: string;
  status: string;
  // RAÍZ-3 (2026-07-21, migración 229): orders.total_paid_cents -- centavos, no dólares.
  total_paid_cents: number;
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

// warranty_claims.final_action — valores conocidos del backend
const FINAL_ACTIONS = ["free_recleaning", "explain_no_action", "dismiss"];

// orders.status CHECK constraint (migración 001_modulo1_base_schema.sql):
// ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')
const ORDER_STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-green-50 text-green-700",
  confirmed: "bg-blue-50 text-blue-700",
  cancelled: "bg-gray-100 text-gray-500",
  no_show: "bg-red-50 text-red-600",
  pending: "bg-amber-50 text-amber-700",
};

export default function MisServiciosClient() {
  const t = useTranslations("cuenta.servicios");
  const tCommon = useTranslations("cuenta.common");
  const tStatus = useTranslations("cuenta.orderStatus");
  const tFinalAction = useTranslations("cuenta.servicios.finalAction");
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimingOrderId, setClaimingOrderId] = useState<string | null>(null);
  // Fix (2026-07-24): este era el destino real del link "Iniciar sesión" de
  // la página principal, pero el componente nunca comprobaba si había
  // sesión -- sin login, /api/client/orders devuelve 401 y eso se mostraba
  // como un StatusBanner de error genérico ("Unauthorized"/"loadFailed"),
  // nunca como un formulario de login. El enlace de autenticación de
  // clientes, en la práctica, no llevaba a ningún lado. Mismo patrón de
  // fix ya aplicado esta sesión en encuesta/[token] y nps/[token].
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setNeedsAuth(true);
        setLoading(false);
        return;
      }
      setNeedsAuth(false);

      const [ordersRes, claimsRes] = await Promise.all([
        fetch("/api/client/orders", { credentials: "include" }),
        fetch("/api/client/warranty-claims", { credentials: "include" }),
      ]);
      if (!ordersRes.ok) {
        if (ordersRes.status === 401) {
          setNeedsAuth(true);
          return;
        }
        const err = await ordersRes.json();
        setError(err.error || t("loadFailed"));
        return;
      }
      const ordersData = await ordersRes.json();
      setOrders(ordersData.orders || []);

      if (claimsRes.ok) {
        const claimsData = await claimsRes.json();
        setClaims(claimsData.claims || []);
      }
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  if (needsAuth) {
    return (
      <AuthModal
        onClose={() => {
          const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en";
          const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
          window.location.href = `/${safeLocale}`;
        }}
        onSuccess={() => loadAll()}
      />
    );
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <div className="text-center space-y-2">
          <Skeleton className="h-8 w-64 mx-auto" />
          <Skeleton className="h-4 w-80 mx-auto" />
        </div>
        <SkeletonServiceList count={4} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-brand-ink mb-2">{t("title")}</h1>
        <p className="text-gray-600">{t("subtitle")}</p>
        <div className="flex items-center justify-center gap-3 mt-2">
          <a href="../propiedades" className="text-xs text-brand-wave-blue hover:text-brand-navy underline">
            {t("manageProperties")}
          </a>
          <a href="../billetera" className="text-xs text-brand-wave-blue hover:text-brand-navy underline">
            {t("luluWallet")}
          </a>
          <a href="../referidos" className="text-xs text-brand-wave-blue hover:text-brand-navy underline">
            {t("referFriend")}
          </a>
        </div>
      </div>

      <NextRecurringVisitCard />
      <LivePortfolioNotice />

      <StatusBanner
        variant="error"
        message={error}
        onRetry={loadAll}
        onDismiss={() => setError("")}
        retryLabel={tCommon("retry")}
        dismissLabel={tCommon("dismiss")}
      />

      {orders.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("noServices")}</p>
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
                        {order.quotes?.service_subtype || t("defaultServiceLabel")}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[order.status] || "bg-gray-100 text-gray-600"}`}>
                        {ORDER_STATUSES.includes(order.status) ? tStatus(order.status) : order.status}
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
                        {t("viewPhotosChecklist")}
                      </a>
                    )}
                    {order.status === "confirmed" && (
                      <a
                        href={`servicios/${order.id}/tracking`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-navy hover:underline"
                      >
                        {t("trackYourTeam")}
                      </a>
                    )}
                    {order.status === "completed" && order.claimableZones.length > 0 && (
                      <button
                        onClick={() => setClaimingOrderId(claimingOrderId === order.id ? null : order.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-wave-blue hover:text-brand-navy border border-brand-wave-blue/30 rounded-lg px-3 py-1.5"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        {t("reportIssue")}
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
                          <p className="mt-1 text-gray-600">
                            {FINAL_ACTIONS.includes(claim.final_action) ? tFinalAction(claim.final_action) : claim.final_action}
                          </p>
                        )}
                        {claim.status === "open" && !claim.final_action && (
                          <p className="mt-1 text-gray-500">{t("underReview")}</p>
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
  const t = useTranslations("cuenta.servicios.claimForm");
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
      setFormError(t("selectZone"));
      return;
    }
    if (reason.trim().length < 3) {
      setFormError(t("describeIssue"));
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
          setFormError(t("photoUploadFailed"));
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
        setFormError(err.error || t("submitFailed"));
        return;
      }

      onSubmitted();
    } catch {
      setFormError(t("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (availableZones.length === 0) {
    return (
      <div className="px-4 pb-4 text-xs text-gray-500">
        {t("allZonesClaimed")}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-1 border-t space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">{t("whichArea")}</label>
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
        <label htmlFor="issue-reason-input" className="text-xs font-medium text-gray-700">{t("whatHappened")}</label>
        <input
          id="issue-reason-input"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("whatHappenedPlaceholder")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="issue-description-textarea" className="text-xs font-medium text-gray-700">{t("moreDetail")}</label>
        <textarea
          id="issue-description-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" />
          {t("photoLabel")}
        </label>
        {photoFile ? (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            {photoFile.name}
            <button type="button" onClick={() => setPhotoFile(null)} aria-label="Remove photo" className="text-gray-400 hover:text-red-500">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <input
            id="issue-photo-input"
            aria-label={t("photoInputAriaLabel")}
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
          {t("cancel")}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg bg-brand-navy text-white hover:bg-brand-navy-light disabled:opacity-50"
        >
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t("submit")}
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
  const t = useTranslations("cuenta.servicios.recurring");
  const router = useRouter();
  const [hasContract, setHasContract] = useState<boolean | null>(null);
  const [nextDate, setNextDate] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState("");
  // v8.3 fix (auditoría 2026-07-15): antes no había ninguna forma de que el
  // cliente pausara o cancelara su contrato recurrente por su cuenta.
  const [statusAction, setStatusAction] = useState<"pause" | "cancel" | null>(null);
  const [statusError, setStatusError] = useState("");
  const [cancelled, setCancelled] = useState(false);

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
        setContractId(json.contractId || null);
      } catch {
        setHasContract(false);
      }
    })();
  }, []);

  async function updateContractStatus(action: "pause" | "cancel") {
    if (!contractId) return;
    if (action === "cancel" && !window.confirm(t("confirmCancel"))) {
      return;
    }
    setStatusAction(action);
    setStatusError("");
    try {
      const res = await fetch(`/api/client/contracts/${contractId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatusError(json.error || t("updateFailed"));
        return;
      }
      if (action === "cancel") setCancelled(true);
      else setHasContract(false); // paused: ya no se ofrece "book next visit" hasta reanudar desde soporte/otra vista
    } catch {
      setStatusError(t("networkError"));
    } finally {
      setStatusAction(null);
    }
  }

  async function bookNextVisit() {
    setBooking(true);
    setBookError("");
    try {
      const infoRes = await fetch("/api/client/contracts/next-visit", { credentials: "include" });
      const info = await infoRes.json();
      if (!infoRes.ok || !info.prefill) {
        setBookError(info.error || t("loadFailed"));
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
        setBookError(quoteJson.error || t("quoteFailed"));
        return;
      }
      const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en";
      const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
      router.push(`/${safeLocale}/reserva/${quoteJson.quoteId}?date=${info.nextDate}`);
    } catch {
      setBookError(t("networkError"));
    } finally {
      setBooking(false);
    }
  }

  if (cancelled) {
    return (
      <div className="bg-brand-ice border border-brand-gold/30 rounded-xl p-4 text-sm text-brand-ink">
        {t("cancelledNotice")}
      </div>
    );
  }

  if (!hasContract) return null;

  return (
    <div className="bg-brand-ice border border-brand-gold/30 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-brand-ink">
          <Repeat className="w-4 h-4 text-brand-gold-dark shrink-0" />
          <span>
            {nextDate ? t("planWithNextVisit", { date: nextDate }) : t("plan")}
          </span>
        </div>
        <button
          aria-label={t("bookNextVisitAriaLabel")}
          onClick={bookNextVisit}
          disabled={booking}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-navy text-white px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {booking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("bookNextVisit")}
        </button>
      </div>
      {bookError && <p className="text-xs text-state-danger">{bookError}</p>}
      <div className="flex items-center gap-4 pt-1">
        <button
          onClick={() => updateContractStatus("pause")}
          disabled={statusAction !== null}
          className="text-xs text-gray-500 underline disabled:opacity-50"
        >
          {statusAction === "pause" ? t("pausing") : t("pausePlan")}
        </button>
        <button
          onClick={() => updateContractStatus("cancel")}
          disabled={statusAction !== null}
          className="text-xs text-state-danger underline disabled:opacity-50"
        >
          {statusAction === "cancel" ? t("cancelling") : t("cancelPlan")}
        </button>
      </div>
      {statusError && <p className="text-xs text-state-danger">{statusError}</p>}
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
  const t = useTranslations("cuenta.servicios.livePortfolio");
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
        setNotice(json.error || t("withdrawFailed"));
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setNotice(t("removed"));
    } catch {
      setNotice(t("networkError"));
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
            <span>{t("selectedNotice", { label: e.anonymous_label })}</span>
          </div>
          {e.canWithdraw && (
            <button
              onClick={() => withdraw(e.id)}
              disabled={withdrawing === e.id}
              className="shrink-0 text-xs font-semibold text-brand-navy border border-brand-navy/30 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {withdrawing === e.id ? t("removing") : t("removeIt")}
            </button>
          )}
        </div>
      ))}
      {notice && <p className="text-xs text-gray-500">{notice}</p>}
    </div>
  );
}
