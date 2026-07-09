"use client";

/**
 * v8.3 E4 — Puente entre la UI y la cola offline (src/lib/offline-queue.ts).
 * Solo se ejecuta en el navegador.
 */

import {
  enqueueServiceEvent,
  runSyncCycle,
  type QueuedServiceEvent,
  type QueuedEventType,
} from "@/lib/offline-queue";

async function sendServiceEvent(
  event: QueuedServiceEvent
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/empleado/servicio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        orderId: event.orderId,
        eventType: event.eventType,
        ...event.payload,
      }),
    });
    if (res.ok) return { ok: true };
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/**
 * Intenta enviar un evento de servicio directo a la API. Si falla por red
 * (no por rechazo del servidor), lo encola en vez de perderlo — silencioso
 * para el empleado, tal como pide D.10 excepción 1.
 */
export async function submitServiceEventOrQueue(
  orderId: string,
  eventType: QueuedEventType,
  payload: Record<string, unknown>
): Promise<{ queued: boolean; ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch("/api/empleado/servicio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ orderId, eventType, ...payload }),
    });
    if (res.ok) {
      const data = await res.json();
      return { queued: false, ok: true, data };
    }
    // Rechazo explícito del servidor (ej. secuencia inválida): NO se encola,
    // encolar un evento que el servidor ya rechazó solo pospondría el mismo error.
    const err = await res.json().catch(() => ({}));
    return { queued: false, ok: false, error: err.error || `HTTP ${res.status}` };
  } catch (e) {
    // Fallo de red real: encolar silenciosamente.
    await enqueueServiceEvent({
      localId: `${orderId}-${eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orderId,
      eventType,
      payload,
      capturedAtIso: new Date().toISOString(),
    });
    return { queued: true, ok: true };
  }
}

let syncing = false;

/** Corre un ciclo de sync si no hay uno en curso ya. Seguro llamar seguido. */
export async function triggerSyncCycle(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    await runSyncCycle(sendServiceEvent);
  } finally {
    syncing = false;
  }
}

let listenersAttached = false;

/** Engancha el sync automático a 'online' + un intervalo de respaldo cada 30s. */
export function attachOfflineSyncListeners(): void {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;

  window.addEventListener("online", () => {
    void triggerSyncCycle();
  });

  // Respaldo: por si 'online' no dispara (algunos navegadores móviles son
  // poco confiables con este evento). No es agresivo — cada 30s.
  setInterval(() => {
    if (navigator.onLine) void triggerSyncCycle();
  }, 30000);

  // Intento inicial al cargar, por si había cola pendiente de una sesión anterior.
  if (navigator.onLine) void triggerSyncCycle();
}
