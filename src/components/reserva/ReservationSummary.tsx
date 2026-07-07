"use client";

import React from "react";
import { QuoteData } from "@/types";
import { MapPin, Home, Calendar, DollarSign, Shield } from "lucide-react";

interface ReservationSummaryProps {
  quote: QuoteData;
  serviceDate?: string;
  serviceTime?: string;
}

export function ReservationSummary({
  quote,
  serviceDate,
  serviceTime,
}: ReservationSummaryProps) {
  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(n);

  const subtypeLabel =
    quote.serviceSubtype
      ?.replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ?? "Cleaning Service";

  return (
    <div className="bg-brand-ice rounded-lg p-5 space-y-4">
      <h3 className="font-semibold text-brand-ink flex items-center gap-2">
        <Shield className="w-5 h-5 text-brand-gold" />
        Reservation Summary
      </h3>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-gray-600">
          <Home className="w-4 h-4" />
          <span className="capitalize">{subtypeLabel}</span>
          <span className="text-gray-400">·</span>
          <span>
            {quote.bedrooms} bed, {quote.bathrooms} bath, {quote.squareFeet} ft²
          </span>
        </div>

        <div className="flex items-center gap-2 text-gray-600">
          <MapPin className="w-4 h-4" />
          <span>{quote.address}</span>
          <span className="text-gray-400">·</span>
          <span>{quote.zone}</span>
        </div>

        {serviceDate && serviceTime && (
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar className="w-4 h-4" />
            <span>
              {new Date(serviceDate).toLocaleDateString("en-CA", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "America/Vancouver",
              })}{" "}
              at {serviceTime}
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 pt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Subtotal</span>
          <span>{formatCurrency(quote.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">GST (5%)</span>
          <span>{formatCurrency(quote.gst)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">PST (7%)</span>
          <span>{formatCurrency(quote.pst)}</span>
        </div>
        <div className="flex justify-between font-semibold text-brand-ink pt-1 border-t border-gray-200">
          <span>Total</span>
          <span>{formatCurrency(quote.total)}</span>
        </div>
      </div>

      <div className="bg-white rounded-lg p-3 border border-brand-gold/30">
        <div className="flex items-center gap-2 text-sm">
          <DollarSign className="w-4 h-4 text-brand-gold" />
          <span className="text-gray-600">Security Hold (T-72h):</span>
          <span className="font-semibold text-brand-ink">
            {formatCurrency(quote.holdAmount)}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Authorization only — no charge at reservation. Charged only if
          cancellation within 72h or no-show.
        </p>
      </div>
    </div>
  );
}
