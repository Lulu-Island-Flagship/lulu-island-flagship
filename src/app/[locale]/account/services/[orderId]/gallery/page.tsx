"use client";

import React, { useCallback,  useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Camera, Clock, MessageSquare, AlertTriangle, CheckCircle2, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { parseVancouverDateTime } from "@/lib/date-utils";

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
  // Fix (2026-07-25, auditoría UX, item 16): antes las fotos eran una
  // grilla estática sin forma de verlas en tamaño completo -- el único
  // patrón de "modal" reutilizable en el repo es el overlay
  // fixed inset-0 bg-black/50 de AuthModal.tsx, así que se replica aquí
  // sin crear una dependencia nueva de librería de lightbox.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!orderId) return;
    load();
  }, [load, orderId]);

  const load = useCallback(async () => {
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
  }, [orderId, t]);

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
              <button
                key={i}
                type="button"
                onClick={() => setLightboxIndex(i)}
                aria-label={t("enlargePhotoAriaLabel", { index: i + 1 })}
                className="relative aspect-square rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-brand-gold"
              >
                <Image
                  src={url}
                  alt={t("servicePhotoAlt", { index: i + 1 })}
                  fill
                  sizes="(max-width: 640px) 50vw, 33vw"
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fix (2026-07-25, auditoría UX, item 16): lightbox simple para ver
          la foto completa -- mismo patrón de overlay que AuthModal.tsx. */}
      {lightboxIndex !== null && data.photos && (
        // Backdrop click-to-close + Escape-to-close on the dialog container is the standard
        // accessible modal dismiss pattern (WCAG 2.1.1 compliant); the rule flags role="dialog"
        // as non-interactive even though this handler only closes on direct backdrop clicks.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("photoLightboxAriaLabel")}
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            // Fix (auditoría a11y 2026-07-30, E6-C7): cerrar solo si el clic
            // fue directamente en el fondo (no en el contenido), y aceptar
            // Escape para cerrar por teclado (WCAG 2.1.1) -- reemplaza el
            // patrón anterior de un onClick+stopPropagation anidado en el
            // div de contenido, que el escáner marcaba como no operable por
            // teclado sin una alternativa real.
            if (e.target === e.currentTarget) setLightboxIndex(null);
          }}
          onKeyDown={(e) => {
            // Fix (auditoría 2026-07-31, hallazgo #11): el lightbox solo
            // mostraba una foto sin forma de navegar a la siguiente/anterior
            // -- con varias fotos por servicio, el cliente tenía que cerrar
            // y reabrir el lightbox para cada una. Se agregan flechas de
            // teclado (ArrowLeft/ArrowRight) con wraparound, igual criterio
            // que los botones de abajo.
            if (e.key === "Escape") setLightboxIndex(null);
            else if (e.key === "ArrowLeft" && data.photos) {
              setLightboxIndex((prev) => (prev === null ? prev : (prev - 1 + data.photos!.length) % data.photos!.length));
            } else if (e.key === "ArrowRight" && data.photos) {
              setLightboxIndex((prev) => (prev === null ? prev : (prev + 1) % data.photos!.length));
            }
          }}
          tabIndex={-1}
        >
          <button
            aria-label={t("closeAriaLabel")}
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white text-3xl leading-none"
          >
            &times;
          </button>
          {/* Fix (auditoría 2026-07-31, hallazgo #11): botones prev/next,
              solo cuando hay más de una foto. */}
          {data.photos.length > 1 && (
            <>
              <button
                type="button"
                aria-label={t("previousPhotoAriaLabel")}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev === null ? prev : (prev - 1 + data.photos!.length) % data.photos!.length));
                }}
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-black/30 hover:bg-black/50 rounded-full p-2"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                aria-label={t("nextPhotoAriaLabel")}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev === null ? prev : (prev + 1) % data.photos!.length));
                }}
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-black/30 hover:bg-black/50 rounded-full p-2"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
          <div className="relative w-full h-full max-w-3xl max-h-[80vh]">
            <Image
              src={data.photos[lightboxIndex]}
              alt={t("servicePhotoAlt", { index: lightboxIndex + 1 })}
              fill
              sizes="100vw"
              className="object-contain"
            />
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
      // Fix (2026-07-25, auditoría UX): revisado -- el cálculo anterior
      // (`new Date(`${selectedDate}T12:00:00Z`).getUTCDay()`) ya era
      // matemáticamente correcto (mediodía UTC nunca cruza el límite de
      // fecha calendario para ningún huso horario terrestre, así que el
      // día de la semana resultante siempre coincide con selectedDate). Se
      // reemplaza igual por el helper compartido parseVancouverDateTime
      // (src/lib/date-utils.ts) para no reinventar el parseo de fechas
      // locales de Vancouver en cada archivo y mantener un solo lugar que
      // maneje el offset PDT/PST.
      const day = parseVancouverDateTime(selectedDate, "12:00").getUTCDay();
      // Fix (auditoría 2026-07-31, hallazgo #3): antes se mandaba
      // `isPreferredDay: true` sin importar el día elegido -- calculatePrice
      // (src/lib/pricing.ts ~L529-534) aplica el recargo logístico de $25
      // cuando dayOfWeek es domingo (0) o sábado (6), y separadamente cuando
      // isPreferredDay === false. Mandar siempre `true` no evitaba el
      // recargo de fin de semana (ese chequeo es independiente), pero SÍ
      // mentía sobre la preferencia real del cliente. "Día preferencial" es
      // simplemente "no es fin de semana" -- se deriva del mismo `day` ya
      // calculado en vez de un valor fijo.
      const isPreferredDay = day !== 0 && day !== 6;
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...rebookInfo.prefill,
          dayOfWeek: day,
          isPreferredDay,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRebookError(json.error || t("createQuoteFailed"));
        return;
      }
      router.push(`/${safeLocale}/booking/${json.quoteId}?date=${selectedDate}`);
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
