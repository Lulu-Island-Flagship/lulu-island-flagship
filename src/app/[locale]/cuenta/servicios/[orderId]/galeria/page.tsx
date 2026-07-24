"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Camera, Clock, MessageSquare, AlertTriangle, CheckCircle2, CalendarPlus } from "lucide-react";

interface RebookDateOption {
  date: string;
  label: string;
  offsetDays: number;
}

interface RebookInfo {
  prefill: Record<string, unknown>;
  suggestedDates: RebookDateOption[];
}

interface ChecklistZone {
  zone: string;
  zoneLabel: string;
  items: { label: string; completed: boolean; photoUrl: string | null }[];
}

interface GalleryData {
  emptyReason?: "not_completed" | "no_photos";
  message?: string;
  photos?: string[];
  checklist?: ChecklistZone[];
  durationMinutes?: number | null;
  leaderNote?: string | null;
  billingMessage?: string;
}

export default function ServiceGalleryPage() {
  const t = useTranslations("cuenta.servicios.galeria");
  const params = useParams();
  const orderId = params?.orderId as string;
  const [data, setData] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId) return;
    load();
  }, [orderId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/client/orders/${orderId}/gallery`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("loadFailed"));
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError(t("networkError"));
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

  if (error) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>;
  }

  if (!data) return null;

  if (data.emptyReason) {
    return (
      <div className="max-w-2xl">
        <div className="bg-white rounded-xl border p-8 text-center space-y-2">
          {data.emptyReason === "not_completed" ? (
            <Clock className="w-10 h-10 text-gray-300 mx-auto" />
          ) : (
            <AlertTriangle className="w-10 h-10 text-state-warning mx-auto" />
          )}
          <p className="text-sm text-gray-600">{data.message}</p>
        </div>
        {data.checklist && data.checklist.length > 0 && (
          <ChecklistView zones={data.checklist} />
        )}
        {data.emptyReason === "no_photos" && (
          <div className="mt-4">
            <RebookWidget orderId={orderId} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("yourService")}</h1>
        {data.durationMinutes !== null && data.durationMinutes !== undefined && (
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
            <Clock className="w-4 h-4" /> {t("completedIn", { minutes: data.durationMinutes })}
          </p>
        )}
      </div>

      {data.photos && data.photos.length > 0 && (
        <div>
          <h2 className="font-semibold text-brand-ink mb-2 flex items-center gap-1.5">
            <Camera className="w-4 h-4" /> {t("photos")}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.photos.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={url} alt={t("servicePhotoAlt", { index: i + 1 })} className="rounded-lg aspect-square object-cover" />
            ))}
          </div>
        </div>
      )}

      {data.leaderNote && (
        <div className="bg-white rounded-xl border p-4 flex items-start gap-2">
          <MessageSquare className="w-4 h-4 text-brand-wave-blue shrink-0 mt-0.5" />
          <p className="text-sm text-gray-700">{data.leaderNote}</p>
        </div>
      )}

      {data.checklist && data.checklist.length > 0 && <ChecklistView zones={data.checklist} />}

      {data.billingMessage && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          {data.billingMessage}
        </div>
      )}

      <RebookWidget orderId={orderId} />
    </div>
  );
}

/**
 * v8.3 E5.12 — "Reagendar desde galería (3 toques)":
 * toque 1 = "Rebook this service", toque 2 = elegir una fecha rápida,
 * toque 3 = "Confirm". Reusa /api/quote (recalcula precio en servidor) y
 * redirige al checkout ya existente /reserva/[quoteId] -- cero lógica de
 * precio o pago nueva.
 */
function RebookWidget({ orderId }: { orderId: string }) {
  const t = useTranslations("cuenta.servicios.galeria.rebook");
  const router = useRouter();
  const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [open, setOpen] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [rebookInfo, setRebookInfo] = useState<RebookInfo | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rebookError, setRebookError] = useState("");

  async function startRebook() {
    setOpen(true);
    setRebookError("");
    if (rebookInfo) return;
    setLoadingOptions(true);
    try {
      const res = await fetch(`/api/client/orders/${orderId}/rebook`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) {
        setRebookError(json.error || t("loadOptionsFailed"));
        return;
      }
      setRebookInfo(json);
    } catch {
      setRebookError(t("networkError"));
    } finally {
      setLoadingOptions(false);
    }
  }

  async function confirmRebook() {
    if (!rebookInfo || !selectedDate) return;
    setConfirming(true);
    setRebookError("");
    try {
      const day = new Date(`${selectedDate}T12:00:00Z`).getUTCDay();
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...rebookInfo.prefill,
          dayOfWeek: day,
          isPreferredDay: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRebookError(json.error || t("createQuoteFailed"));
        return;
      }
      router.push(`/${safeLocale}/reserva/${json.quoteId}?date=${selectedDate}`);
    } catch {
      setRebookError(t("networkError"));
    } finally {
      setConfirming(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={startRebook}
        className="w-full flex items-center justify-center gap-2 bg-brand-navy text-white py-3 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors"
      >
        <CalendarPlus className="w-4 h-4" /> {t("rebookThisService")}
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border p-4 space-y-3">
      <p className="text-sm font-medium text-brand-ink">{t("whenNextVisit")}</p>

      {loadingOptions && <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />}

      {rebookInfo && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {rebookInfo.suggestedDates.map((opt) => (
            <button
              key={opt.date}
              onClick={() => setSelectedDate(opt.date)}
              className={`rounded-lg border-2 p-3 text-sm text-left transition-colors ${
                selectedDate === opt.date ? "border-brand-gold bg-amber-50" : "border-gray-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {rebookError && <p className="text-sm text-state-danger">{rebookError}</p>}

      <button
        aria-label={t("confirmDateAriaLabel")}
        onClick={confirmRebook}
        disabled={!selectedDate || confirming}
        className="w-full bg-brand-navy text-white py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {confirming ? <Loader2 className="w-5 h-5 animate-spin" /> : t("confirm")}
      </button>
    </div>
  );
}

function ChecklistView({ zones }: { zones: ChecklistZone[] }) {
  const t = useTranslations("cuenta.servicios.galeria");
  return (
    <div>
      <h2 className="font-semibold text-brand-ink mb-2">{t("checklist")}</h2>
      <div className="bg-white rounded-xl border divide-y">
        {zones.map((z) => (
          <div key={z.zone} className="p-3">
            <p className="text-sm font-medium text-brand-ink mb-1">{z.zoneLabel}</p>
            <ul className="space-y-1">
              {z.items.map((item, i) => (
                <li key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <CheckCircle2 className={`w-3.5 h-3.5 ${item.completed ? "text-state-success" : "text-gray-300"}`} />
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
