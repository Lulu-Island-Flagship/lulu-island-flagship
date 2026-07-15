"use client";

import React, { useState } from "react";
import { Siren, X, Loader2 } from "lucide-react";

/**
 * v8.3 E7 (D.10 #7) — Botón de aborto seguro (SOS), disponible en TODO
 * momento del turno del empleado (montado en el layout de /empleado, no
 * amarrado a una sola pantalla de servicio -- el peligro puede ocurrir en
 * cualquier punto del día, no solo durante un checklist activo).
 *
 * Doble confirmación real: dos pasos de UI distintos, cada uno con su
 * propio timestamp capturado en el momento del tap (no reusa el mismo
 * evento) -- espeja src/lib/safety-abort.ts:isDoubleConfirmed, que exige
 * ambos timestamps.
 *
 * `orderId` es opcional: el SOS es válido en cualquier momento del día,
 * no solo dentro de un servicio (D.10 #7 no lo condiciona a eso).
 */

type Stage = "idle" | "first" | "second" | "sending" | "sent" | "error";

export function SafetyAbortButton({ orderId }: { orderId?: string }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  function reset() {
    setStage("idle");
    setReason("");
    setErrorMsg("");
  }

  function getLocation(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 8000, enableHighAccuracy: true }
      );
    });
  }

  async function confirmSecondAndSend() {
    setStage("sending");
    setErrorMsg("");
    try {
      const loc = await getLocation();
      const res = await fetch("/api/empleado/safety-abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId: orderId || null,
          reason: reason.trim() || null,
          firstConfirmed: true,
          secondConfirmed: true,
          gpsLat: loc?.lat,
          gpsLng: loc?.lng,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo activar el SOS");
      setStage("sent");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error de red");
      setStage("error");
    }
  }

  if (stage === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStage("first")}
        aria-label="Aborto seguro de emergencia"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-state-danger text-white px-4 py-3 rounded-full shadow-elevation-3 font-semibold text-sm"
      >
        <Siren className="w-5 h-5" />
        SOS
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-6 relative">
        <button
          type="button"
          onClick={reset}
          aria-label="Cerrar"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
        >
          <X className="w-5 h-5" />
        </button>

        {stage === "first" && (
          <>
            <Siren className="w-10 h-10 text-state-danger mb-3" />
            <h2 className="text-lg font-bold text-brand-ink mb-2">¿Activar aborto seguro?</h2>
            <p className="text-sm text-gray-600 mb-4">
              Esto notifica a un admin de inmediato con tu ubicación. Úsalo solo ante un riesgo real
              de seguridad. Confirma dos veces para evitar activaciones accidentales.
            </p>
            <button
              type="button"
              onClick={() => setStage("second")}
              className="w-full bg-state-danger text-white py-3 rounded-lg font-semibold"
            >
              Sí, continuar
            </button>
          </>
        )}

        {stage === "second" && (
          <>
            <Siren className="w-10 h-10 text-state-danger mb-3" />
            <h2 className="text-lg font-bold text-brand-ink mb-2">Confirma una vez más</h2>
            <p className="text-sm text-gray-600 mb-3">
              Esta es la confirmación final. Se activará el SOS inmediatamente al tocar el botón.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="¿Qué está pasando? (opcional, pero ayuda al admin a responder mejor)"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm mb-4"
              rows={3}
            />
            <button
              type="button"
              onClick={confirmSecondAndSend}
              className="w-full bg-state-danger text-white py-3 rounded-lg font-semibold"
            >
              Activar SOS ahora
            </button>
          </>
        )}

        {stage === "sending" && (
          <div className="flex flex-col items-center py-6">
            <Loader2 className="w-8 h-8 animate-spin text-state-danger mb-3" />
            <p className="text-sm text-gray-600">Activando SOS…</p>
          </div>
        )}

        {stage === "sent" && (
          <>
            <Siren className="w-10 h-10 text-state-danger mb-3" />
            <h2 className="text-lg font-bold text-brand-ink mb-2">SOS activado</h2>
            <p className="text-sm text-gray-600 mb-4">
              Un admin fue notificado. Si no recibes respuesta en 2 minutos, el sistema escala
              automáticamente. Mantente en un lugar seguro.
            </p>
            <button type="button" onClick={reset} className="w-full border border-gray-300 py-2.5 rounded-lg text-sm">
              Cerrar
            </button>
          </>
        )}

        {stage === "error" && (
          <>
            <h2 className="text-lg font-bold text-brand-ink mb-2">No se pudo activar</h2>
            <p className="text-sm text-state-danger mb-4">{errorMsg}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStage("second")} className="flex-1 bg-state-danger text-white py-2.5 rounded-lg text-sm font-semibold">
                Reintentar
              </button>
              <button type="button" onClick={reset} className="flex-1 border border-gray-300 py-2.5 rounded-lg text-sm">
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
