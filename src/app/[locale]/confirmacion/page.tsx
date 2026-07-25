"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { mapQuoteFromSupabase, mapOrderFromSupabase } from "@/lib/supabase-mappers";
import { formatServiceDateDisplay } from "@/lib/date-utils";
import { Order, QuoteData } from "@/types";
import {
  CheckCircle2,
  Calendar,
  MapPin,
  Home,
  DollarSign,
  Shield,
  ChevronRight,
  Loader2,
} from "lucide-react";

function ConfirmacionContent() {
  const t = useTranslations("confirmacion");
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");

  // Detect locale from pathname for navigation
  const locale = (typeof window !== "undefined"
    ? window.location.pathname.split("/")[1]
    : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [order, setOrder] = useState<Order | null>(null);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  // Fix (2026-07-25, auditoría UX): antes un solo "Reservation Not Found"
  // cubría tres situaciones muy distintas -- (a) se llegó a esta página sin
  // ?orderId en absoluto (link roto / bookmark viejo), y (b) hay un orderId
  // pero orders_client_view no devolvió fila. La vista aplica RLS por
  // user_id (migración 056): una orden que EXISTE pero pertenece a otro
  // cliente devuelve el mismo "sin filas" que una orden que directamente no
  // existe -- por diseño, para no filtrar si un ID es válido o no a quien no
  // es su dueño. Por eso (b) se muestra como un único mensaje "no
  // encontrada o sin acceso" (no se puede ni se debe distinguir de forma
  // segura entre "no existe" y "no autorizado" en el cliente), pero SÍ se
  // distingue de (a), que es un error de navegación completamente distinto.
  const [notFoundReason, setNotFoundReason] = useState<"missingOrderId" | "orderNotFound" | null>(null);

  useEffect(() => {
    async function loadOrder() {
      if (!orderId) {
        setNotFoundReason("missingOrderId");
        setLoading(false);
        return;
      }

      // v8.3 E1: blindaje DB — vista orders_client_view (migración 056)
      const { data: orderData, error: orderError } = await supabase
        .from("orders_client_view")
        .select("*")
        .eq("id", orderId)
        .single();

      if (orderError || !orderData) {
        setNotFoundReason("orderNotFound");
        setLoading(false);
        return;
      }

      const mappedOrder = mapOrderFromSupabase(orderData);
      setOrder(mappedOrder);

      // Load associated quote
      if (orderData.quote_id) {
        const { data: quoteData } = await supabase
          .from("quotes_client_view")
          .select("*")
          .eq("id", orderData.quote_id)
          .single();
        if (quoteData) {
          const mappedQuote = mapQuoteFromSupabase(quoteData);
          setQuote(mappedQuote);
        }
      }

      setLoading(false);
    }

    loadOrder();
  }, [orderId]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(n);

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </main>
    );
  }

  if (!order || !quote) {
    const isMissingOrderId = notFoundReason === "missingOrderId";
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-lg shadow-elevation-1 p-8 max-w-md w-full text-center">
          <h2 className="text-xl font-bold text-brand-ink mb-2">
            {isMissingOrderId ? t("missingOrderIdTitle") : t("notFoundTitle")}
          </h2>
          <p className="text-gray-600 mb-6">
            {isMissingOrderId ? t("missingOrderIdDesc") : t("notFoundDesc")}
          </p>
          <button
            onClick={() => router.push(`/${safeLocale}/cotizador`)}
            className="inline-flex items-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors"
          >
            {t("getQuote")}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </main>
    );
  }

  const subtypeLabel =
    quote.serviceSubtype
      ?.replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ?? t("defaultServiceLabel");

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-brand-gold" />
            <span className="font-semibold">{t("brand")}</span>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-lg shadow-elevation-1 p-8 text-center space-y-6">
          <div className="w-16 h-16 bg-state-success/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-state-success" />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-brand-ink mb-2">
              {t("title")}
            </h1>
            <p className="text-gray-600">
              {t("subtitle")}
            </p>
          </div>

          <div className="text-left bg-brand-ice rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-3">
              <Home className="w-5 h-5 text-brand-gold" />
              <div>
                <p className="text-sm text-gray-500">{t("serviceLabel")}</p>
                <p className="font-medium text-brand-ink capitalize">
                  {subtypeLabel}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-brand-gold" />
              <div>
                <p className="text-sm text-gray-500">{t("dateTimeLabel")}</p>
                <p className="font-medium text-brand-ink">
                  {formatServiceDateDisplay(order.serviceDate)}{" "}
                  {t("at")} {order.serviceTime}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-brand-gold" />
              <div>
                <p className="text-sm text-gray-500">{t("locationLabel")}</p>
                <p className="font-medium text-brand-ink">
                  {quote.address}, {quote.zone}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-brand-gold" />
              <div>
                <p className="text-sm text-gray-500">{t("totalLabel")}</p>
                <p className="font-medium text-brand-ink">
                  {formatCurrency(quote.total)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-brand-navy/5 rounded-lg p-4 text-sm text-left space-y-2">
            <p className="font-medium text-brand-ink">{t("whatNextTitle")}</p>
            <ul className="text-gray-600 space-y-1 list-disc list-inside">
              <li>
                {t("next1", { amount: formatCurrency(quote.total) })}
              </li>
              <li>
                {t("next2", { amount: formatCurrency(quote.holdAmount) })}
              </li>
              <li>
                {t("next3")}
              </li>
              <li>
                {t("next4")}
              </li>
            </ul>
          </div>

          {/* 2026-07-24: la confirmación era un callejón sin salida — el
              cliente solo tenía "Back to Home" y tenía que adivinar la URL
              de /cuenta para ver o rastrear su reserva. Se añade "View My
              Reservation". No se añade link de "instrucciones especiales
              para el equipo": no existe ese campo/feature en el backend (sin
              columna en orders/quotes ni endpoint) — pendiente de decisión
              de producto antes de exponer un formulario que no tiene adónde
              escribir. Tampoco se crea una página nueva de "política de
              cancelación": las condiciones ya se explican arriba en "What
              happens next?". Existe /api/orders/[orderId]/cancel en el
              backend, pero ninguna pantalla de /cuenta expone hoy un botón
              de cancelar para una orden individual, así que un link a la
              orden no añadiría una acción de cancelar que hoy no esté ya
              disponible ahí.

              Fix (2026-07-25, auditoría UX): antes este botón enlazaba
              directo a .../tracking -- esa pantalla solo muestra la
              ubicación del vehículo dentro de los 30 min previos al
              servicio (ver vehicle-tracking route), así que para una
              reserva RECIÉN confirmada (a menudo días u horas antes del
              servicio) tracking está casi siempre vacío ("not_trackable" /
              "too_early"), un callejón sin salida disfrazado de link útil.
              Se cambia a /cuenta/servicios (con fallback igual si no hay
              orderId), que sí muestra la reserva recién creada de inmediato
              y desde ahí el cliente puede navegar a tracking cuando
              corresponda. */}
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => router.push(`/${safeLocale}/cuenta/servicios`)}
              className="inline-flex items-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors"
            >
              {t("viewReservation")}
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => router.push(`/${safeLocale}`)}
              className="inline-flex items-center gap-2 bg-white text-brand-navy border border-brand-navy/30 px-6 py-3 rounded-lg font-semibold hover:bg-brand-ice transition-colors"
            >
              {t("backToHome")}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function ConfirmacionPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-brand-ice flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </main>
      }
    >
      <ConfirmacionContent />
    </Suspense>
  );
}
