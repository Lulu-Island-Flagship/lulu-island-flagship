"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { mapQuoteFromSupabase, mapOrderFromSupabase } from "@/lib/supabase-mappers";
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

  useEffect(() => {
    async function loadOrder() {
      if (!orderId) {
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
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-lg shadow-elevation-1 p-8 max-w-md w-full text-center">
          <h2 className="text-xl font-bold text-brand-ink mb-2">
            Reservation Not Found
          </h2>
          <p className="text-gray-600 mb-6">
            We couldn&apos;t find your reservation details.
          </p>
          <button
            onClick={() => router.push(`/${safeLocale}/cotizador`)}
            className="inline-flex items-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors"
          >
            Get a Quote
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </main>
    );
  }

  const serviceDate = new Date(order.serviceDate);
  const subtypeLabel =
    quote.serviceSubtype
      ?.replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ?? "Cleaning Service";

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-brand-gold" />
            <span className="font-semibold">Lulu Island Flagship</span>
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
              Reservation Confirmed
            </h1>
            <p className="text-gray-600">
              Your cleaning service is scheduled. We&apos;ll see you then!
            </p>
          </div>

          <div className="text-left bg-brand-ice rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-3">
              <Home className="w-5 h-5 text-brand-gold" />
              <div>
                <p className="text-sm text-gray-500">Service</p>
                <p className="font-medium text-brand-ink capitalize">
                  {subtypeLabel}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-brand-gold" />
              <div>
                <p className="text-sm text-gray-500">Date & Time</p>
                <p className="font-medium text-brand-ink">
                  {serviceDate.toLocaleDateString("en-CA", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    timeZone: "America/Vancouver",
                  })}{" "}
                  at {order.serviceTime}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-brand-gold" />
              <div>
                <p className="text-sm text-gray-500">Location</p>
                <p className="font-medium text-brand-ink">
                  {quote.address}, {quote.zone}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-brand-gold" />
              <div>
                <p className="text-sm text-gray-500">Total</p>
                <p className="font-medium text-brand-ink">
                  {formatCurrency(quote.total)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-brand-navy/5 rounded-lg p-4 text-sm text-left space-y-2">
            <p className="font-medium text-brand-ink">What happens next?</p>
            <ul className="text-gray-600 space-y-1 list-disc list-inside">
              <li>
                Total service amount: {formatCurrency(quote.total)}. Charged
                automatically after service completion at 7:00 PM Vancouver
                time.
              </li>
              <li>
                72 hours before service: a temporary hold of{" "}
                {formatCurrency(quote.holdAmount)} will be authorized on your
                card (not charged). It is only charged if you cancel late or
                don&apos;t show up.
              </li>
              <li>
                Day of service: our team arrives at the scheduled time.
              </li>
              <li>
                You&apos;ll receive a gallery of before/after photos after the
                service.
              </li>
            </ul>
          </div>

          <div className="pt-4">
            <button
              onClick={() => router.push(`/${safeLocale}`)}
              className="inline-flex items-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors"
            >
              Back to Home
              <ChevronRight className="w-5 h-5" />
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
