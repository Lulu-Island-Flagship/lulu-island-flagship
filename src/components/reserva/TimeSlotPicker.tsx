"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, Loader2, AlertCircle } from "lucide-react";

interface CapacitySlot {
  id: string;
  serviceDate: string;
  startTime: string;
  endTime: string;
  slotType: "blocked" | "flexible" | "contingency";
  maxTeams: number;
  committedTeams: number;
  available: boolean;
  blockedReason?: string | null;
}

interface TimeSlotPickerProps {
  value: string; // HH:MM
  onChange: (time: string) => void;
  serviceDate?: string; // YYYY-MM-DD
  zone?: string;
  serviceType?: string;
  squareFeet?: number;
}

function isWeekend(dateStr: string): boolean {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function TimeSlotPicker({
  value,
  onChange,
  serviceDate,
  zone,
  serviceType,
  squareFeet,
}: TimeSlotPickerProps) {
  const t = useTranslations("reserva.timeSlotPicker");
  const [slots, setSlots] = useState<CapacitySlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // v8.3 fix (auditoría E1 2026-07-18): /api/capacity ahora aplica
  // prioridad Recurrente > Esporádico > Nuevo y devuelve
  // newClientLimitReached cuando un cliente Nuevo (0 servicios completados)
  // ya tiene una reserva activa -- antes no había ningún límite ni aviso.
  const [newClientLimitReached, setNewClientLimitReached] = useState(false);

  useEffect(() => {
    if (!serviceDate) {
      setSlots([]);
      return;
    }

    async function loadCapacity() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ date: serviceDate || "" });
        if (zone) params.set("zone", zone);
        if (serviceType) params.set("serviceType", serviceType);
        if (squareFeet) params.set("squareFeet", String(squareFeet));

        const res = await fetch(`/api/capacity?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || t("loadFailed"));
          setSlots([]);
          return;
        }
        const data = await res.json();
        setSlots(data.slots || []);
        setNewClientLimitReached(!!data.newClientLimitReached);
      } catch {
        setError(t("networkError"));
        setSlots([]);
      } finally {
        setLoading(false);
      }
    }

    loadCapacity();
  }, [serviceDate, zone, serviceType, squareFeet, t]);

  const weekend = serviceDate ? isWeekend(serviceDate) : false;
  const hasAvailable = slots.some((s) => s.available);

  if (loading) {
    return (
      <div className="space-y-3">
        <label className="block text-sm font-medium text-brand-ink">{t("label")}</label>
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("checkingCapacity")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-brand-ink">{t("label")}</label>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
          {error}
        </div>
      )}

      {!error && newClientLimitReached && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{t("newClientLimitWarning")}</span>
        </div>
      )}

      {!error && !newClientLimitReached && slots.length > 0 && !hasAvailable && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{t("noSlotsAvailable")}</span>
        </div>
      )}

      {slots.length === 0 && !error && !loading && (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
          {t("capacityNotAvailable")}
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {slots.map((slot) => {
          const isSelected = value === slot.startTime;
          const disabled = !slot.available;
          return (
            <button
              key={slot.id}
              onClick={() => !disabled && onChange(slot.startTime)}
              disabled={disabled}
              title={
                disabled
                  ? slot.blockedReason || t("slotUnavailable")
                  : `${slot.startTime} – ${slot.endTime}`
              }
              className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isSelected
                  ? "bg-brand-navy text-white"
                  : disabled
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-100"
                  : "bg-gray-50 text-brand-ink hover:bg-gray-100 border border-gray-200"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              {slot.startTime}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        {t("serviceWindow")}
        {weekend && (
          <span className="block text-brand-gold mt-1">
            {t("weekendSurcharge")}
          </span>
        )}
      </p>
    </div>
  );
}
