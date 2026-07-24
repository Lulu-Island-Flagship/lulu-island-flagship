"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Calendar, AlertCircle } from "lucide-react";

interface DatePickerProps {
  value: string; // ISO date string YYYY-MM-DD
  onChange: (date: string) => void;
  minDate?: string;
  maxDate?: string;
}

/**
 * Devuelve la fecha local de Vancouver como string YYYY-MM-DD.
 * No usa Date.parse para evitar desfaces por la zona horaria del navegador.
 */
function getVancouverDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function getVancouverHour(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().split("T")[0];
}

function addYears(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y + years, m - 1, d));
  return date.toISOString().split("T")[0];
}

export function DatePicker({ value, onChange, minDate, maxDate }: DatePickerProps) {
  const t = useTranslations("reserva.datePicker");
  const vancouverToday = getVancouverDateString();
  const vancouverHour = getVancouverHour();
  const tomorrow = addDays(vancouverToday, 1);

  // Corte de las 5:00 PM del día anterior: si ya pasó el corte, mañana no es elegible.
  const cutoffPassed = vancouverHour >= 17;
  const effectiveMin = minDate ?? (cutoffPassed ? addDays(vancouverToday, 2) : tomorrow);
  const effectiveMax = maxDate ?? addYears(vancouverToday, 1);

  const [warning, setWarning] = useState("");

  useEffect(() => {
    if (value && value === tomorrow && cutoffPassed) {
      setWarning(t("cutoffWarning"));
    } else {
      setWarning("");
    }
  }, [value, tomorrow, cutoffPassed, t]);

  return (
    <div className="space-y-3">
      <label htmlFor="service-date-input" className="block text-sm font-medium text-brand-ink">
        {t("label")}
      </label>
      <div className="relative">
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          id="service-date-input"
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          min={effectiveMin}
          max={effectiveMax}
          className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 focus:border-brand-gold focus:ring-1 focus:ring-brand-gold outline-none text-brand-ink"
        />
      </div>
      {warning ? (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          {t("helpText", { date: effectiveMin })}
        </p>
      )}
    </div>
  );
}
