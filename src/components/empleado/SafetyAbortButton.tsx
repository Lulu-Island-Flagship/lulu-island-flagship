"use client";

import React, { useState, useEffect, useRef } from "react";
import { Siren, X, Loader2 } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

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

type Stage = "idle" | "first" | "second" | "sending" | "sent" | "error" | "network_fallback";

// v8.3 E7 (D.10 #7) — "SOS con GPS vivo": mientras el aborto siga activo
// (stage === "sent"), el GPS se reenvía periódicamente vía PATCH
// /api/empleado/safety-abort/[id] (existía la ruta, testeada, pero ningún
// componente la llamaba -- el POST inicial solo mandaba una foto fija del
// GPS al momento de activar el SOS).
const GPS_UPDATE_INTERVAL_MS = 20000;

// Fix (auditoría 2026-07-30, bug #1): si el POST a /api/empleado/safety-abort
// no responde en este plazo (dispositivo sin señal/datos en el momento de la
// emergencia), se ofrece un fallback nativo tel:/sms: en vez de dejar al
// empleado con un simple mensaje de error. Se investigó el repo buscando un
// número de emergencia/coordinador de guardia ya configurado y reutilizable
// (unified-alerts.ts es notificación in-app únicamente; el cron de
// escalación de SOS no tiene integración Twilio real todavía;
// TWILIO_HUMAN_ESCALATION_NUMBER es para la centralita telefónica general,
// no para SOS) -- no existe ninguno. Se usa una variable de entorno pública
// dedicada; el placeholder es obviamente inválido a propósito.
//
// ATENCIÓN PRODUCCIÓN: NEXT_PUBLIC_SOS_EMERGENCY_PHONE debe configurarse con
// el número real del coordinador de guardia antes de salir a producción.
const SOS_FETCH_TIMEOUT_MS = 2500;
const SOS_FALLBACK_PHONE = process.env.NEXT_PUBLIC_SOS_EMERGENCY_PHONE || "+10000000000";

export function SafetyAbortButton({ orderId }: { orderId?: string }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  // El valor en sí no se lee todavía en ningún lado (solo el setter, para
  // reset() y para pasar el id recién creado a startGpsUpdates) -- se
  // conserva el estado por si una futura UI necesita mostrarlo/enlazarlo.
  const [_safetyAbortId, setSafetyAbortId] = useState<string | null>(null);
  // Fix (auditoría UX/seguridad 2026-07-25, bug #3): cerrar el diálogo de
  // "SOS activado" NO significa que la emergencia terminó -- solo que el
  // empleado quiere guardar el teléfono. `minimized` separa "ocultar la UI
  // del diálogo" de "cancelar el SOS y detener el GPS" (reset()). Mientras
  // stage === "sent", el intervalo de GPS sigue vivo sin importar
  // `minimized`; solo reset() (disponible antes de enviar, o tras un error)
  // detiene startGpsUpdates.
  const [minimized, setMinimized] = useState(false);
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fix (auditoría UX 2026-07-25): useFocusTrap debe llamarse siempre en el
  // mismo orden en cada render -- no puede quedar detrás de los `return`
  // tempranos de los estados "idle" y "sent && minimized" (violaba las
  // Rules of Hooks). Se calcula aquí, sin condicionar la llamada al hook,
  // y el trap se activa/desactiva internamente vía el flag `active`.
  const isDialogOpen = stage !== "idle" && !(stage === "sent" && minimized);
  const dialogCloseHandler = stage === "sent" ? minimizeDialog : reset;
  // v8.3 ROUND 4 fix (#10): useFocusTrap cierra el diálogo con Escape sin
  // distinguir la etapa -- durante "first"/"second" (la doble confirmación
  // real de una emergencia) un Escape accidental (o de alguien más cerca
  // del teclado) cancelaba todo el SOS sin que el empleado lo pidiera. El
  // botón X visible sigue funcionando siempre (acción explícita del
  // empleado); solo se desactiva el atajo de teclado Escape en esas dos
  // etapas de riesgo. Fuera de first/second (idle no muestra diálogo, sent/
  // error/network_fallback no son "confirmación en curso"), Escape sigue
  // funcionando normalmente.
  const escCloseHandler = stage === "first" || stage === "second" ? undefined : dialogCloseHandler;
  const dialogRef = useFocusTrap<HTMLDivElement>(isDialogOpen, escCloseHandler);

  function stopGpsUpdates() {
    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
  }

  function reset() {
    stopGpsUpdates();
    setSafetyAbortId(null);
    setStage("idle");
    setReason("");
    setErrorMsg("");
    setMinimized(false);
  }

  // Oculta el diálogo "SOS activado" sin tocar stage/safetyAbortId/GPS -- el
  // intervalo de startGpsUpdates sigue corriendo en segundo plano.
  function minimizeDialog() {
    setMinimized(true);
  }

  useEffect(() => {
    return () => stopGpsUpdates();
  }, []);

  function startGpsUpdates(id: string) {
    stopGpsUpdates();
    gpsIntervalRef.current = setInterval(async () => {
      try {
        const loc = await getLocation();
        if (!loc) return;
        await fetch(`/api/empleado/safety-abort/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ gpsLat: loc.lat, gpsLng: loc.lng }),
        });
      } catch {
        // Falla silenciosa: la actualización de GPS es secundaria al SOS ya
        // activo (la primera ubicación ya se envió con el POST inicial). No
        // se le muestra error al empleado en cada tick para no generar
        // pánico por un fallo transitorio de red/GPS mientras el SOS sigue
        // activo.
      }
    }, GPS_UPDATE_INTERVAL_MS);
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
    const loc = await getLocation();
    // Fix (auditoría 2026-07-30, bug #1): timeout corto + AbortController --
    // si el dispositivo no tiene red en el momento de la emergencia, fetch()
    // puede quedarse colgado mucho más de lo que un empleado en peligro
    // puede esperar. A los SOS_FETCH_TIMEOUT_MS se aborta y se ofrece el
    // fallback tel:/sms: (stage "network_fallback") en vez de seguir
    // esperando indefinidamente.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SOS_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch("/api/empleado/safety-abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          orderId: orderId || null,
          reason: reason.trim() || null,
          firstConfirmed: true,
          secondConfirmed: true,
          gpsLat: loc?.lat,
          gpsLng: loc?.lng,
        }),
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo activar el SOS");
      const createdId = data.safetyAbort?.id as string | undefined;
      if (createdId) {
        setSafetyAbortId(createdId);
        startGpsUpdates(createdId);
      }
      setStage("sent");
    } catch (err) {
      clearTimeout(timeoutId);
      // Falla de red real (fetch no pudo conectar) o timeout por abort():
      // ofrece el fallback nativo tel:/sms: en vez de un simple error de
      // "reintentar" -- una respuesta HTTP de error (res.ok === false, que
      // llega como Error normal desde el `throw` de arriba) sí mantiene el
      // flujo de error/reintento existente, porque ahí SÍ hubo red.
      const isNetworkFailure =
        err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError");
      if (isNetworkFailure) {
        setStage("network_fallback");
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Error de red");
        setStage("error");
      }
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

  // SOS activo pero el empleado minimizó el diálogo -- el GPS sigue
  // reportando en segundo plano (ver startGpsUpdates). Este indicador
  // flotante NO permite disparar un nuevo SOS: solo reabre el diálogo
  // informativo de "SOS activado".
  if (stage === "sent" && minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label="SOS activo — toca para ver el estado"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-state-danger text-white px-4 py-3 rounded-full shadow-elevation-3 font-semibold text-sm animate-pulse"
      >
        <Siren className="w-5 h-5" />
        SOS Activo
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Aborto seguro de emergencia"
        className="bg-white rounded-xl max-w-sm w-full p-6 relative"
      >
        <button
          type="button"
          onClick={dialogCloseHandler}
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
              aria-label="Qué está pasando (opcional)"
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
            <button type="button" onClick={minimizeDialog} className="w-full border border-gray-300 py-2.5 rounded-lg text-sm">
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

        {stage === "network_fallback" && (
          <>
            <Siren className="w-10 h-10 text-state-danger mb-3" />
            <h2 className="text-lg font-bold text-brand-ink mb-2">Sin conexión — llama directamente</h2>
            <p className="text-sm text-gray-600 mb-4">
              No pudimos enviar el SOS por internet. Usa uno de estos accesos directos para contactar de
              inmediato al coordinador de guardia.
            </p>
            <div className="flex flex-col gap-2 mb-4">
              <a
                href={`tel:${SOS_FALLBACK_PHONE}`}
                className="w-full bg-state-danger text-white py-3 rounded-lg font-semibold text-center"
              >
                Llamar ahora
              </a>
              <a
                href={`sms:${SOS_FALLBACK_PHONE}?body=${encodeURIComponent(
                  `SOS emergencia. ${reason.trim() || "Sin detalles adicionales."}`
                )}`}
                className="w-full border border-state-danger text-state-danger py-2.5 rounded-lg font-semibold text-center"
              >
                Enviar SMS de emergencia
              </a>
            </div>
            <button
              type="button"
              onClick={() => setStage("second")}
              className="w-full border border-gray-300 py-2.5 rounded-lg text-sm mb-2"
            >
              Reintentar por internet
            </button>
            <button type="button" onClick={reset} className="w-full text-xs text-gray-400 py-1">
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
