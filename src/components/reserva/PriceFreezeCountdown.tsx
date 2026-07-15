"use client";

import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface PriceFreezeCountdownProps {
  frozenUntilIso: string | undefined;
  onExpired?: () => void;
}

/**
 * v8.3 fix (auditoría de flujo cliente, 2026-07-15): el precio de una quote
 * se congela por 10 minutos (ver /api/quote/route.ts), y el servidor SÍ
 * rechaza la confirmación con 410 si ese freeze ya venció -- pero la
 * página de reserva no mostraba NINGÚN countdown mientras el cliente
 * elegía fecha/hora y llenaba los datos de la tarjeta (Stripe Elements,
 * autocompletado, 3-D Secure), un proceso que fácilmente toma varios
 * minutos. El cliente podía llegar al final del flujo, hacer clic en
 * "Confirm Reservation", y recibir un genérico "Quote has expired" sin
 * haber sido advertido -- perdiendo todo el trabajo ya hecho.
 */
export function PriceFreezeCountdown({ frozenUntilIso, onExpired }: PriceFreezeCountdownProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [firedExpired, setFiredExpired] = useState(false);

  useEffect(() => {
    if (!frozenUntilIso) {
      setSecondsLeft(null);
      return;
    }
    const target = new Date(frozenUntilIso).getTime();
    if (Number.isNaN(target)) {
      setSecondsLeft(null);
      return;
    }

    function tick() {
      const remaining = Math.max(0, Math.round((target - Date.now()) / 1000));
      setSecondsLeft(remaining);
      return remaining;
    }

    const initial = tick();
    if (initial <= 0) return;

    const interval = setInterval(() => {
      const remaining = tick();
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [frozenUntilIso]);

  useEffect(() => {
    if (secondsLeft === 0 && !firedExpired) {
      setFiredExpired(true);
      onExpired?.();
    }
  }, [secondsLeft, firedExpired, onExpired]);

  if (secondsLeft === null) return null;

  if (secondsLeft <= 0) {
    return (
      <div className="bg-state-danger/10 border border-state-danger text-state-danger text-sm rounded-lg p-3 flex items-center gap-2">
        <Clock className="w-4 h-4 shrink-0" />
        Your price hold has expired. Please refresh to get a new quote before confirming.
      </div>
    );
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const low = secondsLeft <= 60;

  return (
    <div
      className={`text-sm rounded-lg p-3 flex items-center gap-2 border ${
        low ? "bg-state-warning/10 border-state-warning text-state-warning" : "bg-brand-ice border-brand-gold/30 text-brand-ink"
      }`}
    >
      <Clock className="w-4 h-4 shrink-0" />
      Price held for {minutes}:{String(seconds).padStart(2, "0")} — complete your reservation before it expires.
    </div>
  );
}
