"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";

interface PriceFreezeCountdownProps {
  frozenUntilIso: string | undefined;
  onExpired?: () => void;
}

/**
 * v8.3 fix (auditoría de flujo cliente, 2026-07-15): el precio de una quote
 * se congela por 10 minutos (ver /api/quote/route.ts), y el servidor SÍ
 * rechaza la confirmación con 410 si ese freeze ya venció -- pero la
 * página de reserva no mostraba NINGÚN aviso mientras el cliente elegía
 * fecha/hora y llenaba los datos de la tarjeta (Stripe Elements,
 * autocompletado, 3-D Secure), un proceso que fácilmente toma varios
 * minutos. El cliente podía llegar al final del flujo, hacer clic en
 * "Confirm Reservation", y recibir un genérico "Quote has expired" sin
 * haber sido advertido -- perdiendo todo el trabajo ya hecho.
 *
 * v8.3 fix (auditoría E1 2026-07-18): el spec pide "latencia de red, no
 * cronómetro regresivo visible" -- el MM:SS que se actualizaba cada
 * segundo es exactamente eso: un cronómetro regresivo. Ahora el freeze se
 * renueva automáticamente mientras el cliente está activo (heartbeat en
 * /api/quote/freeze-ping, ver reserva/[quoteId]/page.tsx), así que no hay
 * razón para hacer sentir al cliente que "el tiempo se acaba" segundo a
 * segundo -- eso es presión de UX, no información útil. Este componente ya
 * NO muestra MM:SS: se queda en silencio (igual que la latencia de red
 * normal) y solo aparece una advertencia sutil si de verdad quedan menos de
 * 60 segundos Y el heartbeat no logró renovar (p.ej. red caída, pestaña en
 * background con timers pausados por el navegador).
 */
export function PriceFreezeCountdown({ frozenUntilIso, onExpired }: PriceFreezeCountdownProps) {
  const t = useTranslations("reserva.priceFreezeCountdown");
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

    // Se revisa cada 5s (no cada 1s) -- esto ya no alimenta un display de
    // MM:SS en vivo, solo necesita saber si cruzó el umbral de "último
    // minuto" o si expiró, así que no hace falta granularidad de 1 segundo.
    const interval = setInterval(() => {
      const remaining = tick();
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 5000);

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
        {t("expired")}
      </div>
    );
  }

  // Último minuto: única señal visible, sin cifras que cuenten hacia atrás.
  if (secondsLeft <= 60) {
    return (
      <div className="text-sm rounded-lg p-3 flex items-center gap-2 border bg-state-warning/10 border-state-warning text-state-warning">
        <Clock className="w-4 h-4 shrink-0" />
        {t("aboutToExpire")}
      </div>
    );
  }

  // Fuera del último minuto: sin cronómetro visible (spec: "latencia de red,
  // no cronómetro regresivo visible"). Un indicador neutro y estático de que
  // el precio está protegido, sin cifras que decrementen.
  return (
    <div className="text-sm rounded-lg p-3 flex items-center gap-2 border bg-brand-ice border-brand-gold/30 text-brand-ink">
      <Clock className="w-4 h-4 shrink-0" />
      {t("held")}
    </div>
  );
}
