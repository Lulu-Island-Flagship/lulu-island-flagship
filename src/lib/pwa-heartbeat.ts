"use client";

/**
 * v8.3 E4 — C.6: PWA Heartbeat de salud del empleado en campo.
 *
 * WorkSafeBC BC OHS 4.22 (trabajo en aislamiento): el sistema debe saber si
 * un empleado en una propiedad vacía sigue activo. Si la PWA no emite
 * heartbeat en >15 minutos, se dispara una alerta al admin con la última
 * ubicación conocida para intervenir.
 *
 * Extiende src/lib/offline-sync-client.ts: el heartbeat usa el mismo
 * mecanismo de encolado offline (IndexedDB + reintento con backoff). Si la
 * PWA no tiene red, el heartbeat se encola y se envía en el próximo sync
 * — pero el timer de 15 min corre del lado del servidor (no del cliente),
 * así que la falta de heartbeat se detecta aunque los mensajes estén
 * encolados.
 *
 * @module pwa-heartbeat
 */

import { z } from "zod";
import { enqueueServiceEvent } from "@/lib/offline-queue";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Intervalo entre heartbeats enviados desde la PWA (milisegundos). */
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/** Ventana de silencio máximo antes de disparar alerta admin (minutos). */
export const HEARTBEAT_MISSING_MINUTES = 15;

/** Nombre del canal Realtime de Supabase donde se publican las alertas de heartbeat. */
export const HEARTBEAT_ALERT_CHANNEL = "pwa-heartbeat-alerts";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Payload que la PWA envía en cada heartbeat. */
export const HeartbeatPayloadSchema = z.object({
  equipo_id: z.string().min(1, "equipo_id es requerido"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  bateria_pct: z.number().int().min(0).max(100),
});

/** Tipo inferido del payload de heartbeat. */
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

/** Estado local del heartbeat en la PWA. */
export const HeartbeatClientStateSchema = z.object({
  lastSentAtIso: z.string().datetime({ offset: true }).nullable(),
  lastKnownLocation: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .nullable(),
  intervalId: z.number().nullable().optional(),
  enabled: z.boolean(),
});

/** Tipo inferido del estado local. */
export type HeartbeatClientState = z.infer<typeof HeartbeatClientStateSchema>;

/** Alerta de heartbeat perdido generada del lado del servidor para el admin. */
export const HeartbeatMissingAlertSchema = z.object({
  equipo_id: z.string(),
  lastHeartbeatAtIso: z.string().datetime({ offset: true }),
  lastKnownLat: z.number(),
  lastKnownLng: z.number(),
  missingMinutes: z.number(),
  bateria_pct: z.number().int().min(0).max(100).nullable(),
});

/** Tipo inferido de la alerta de heartbeat perdido. */
export type HeartbeatMissingAlert = z.infer<typeof HeartbeatMissingAlertSchema>;

// ---------------------------------------------------------------------------
// PWA-side: heartbeat sender
// ---------------------------------------------------------------------------

let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Obtiene la ubicación actual del dispositivo vía Geolocation API.
 * Retorna null si el usuario no otorgó permiso o el dispositivo no
 * tiene GPS (el heartbeat sin GPS sigue siendo válido — el lat/lng
 * puede ser null en ese caso, pero el servidor aún registra el timestamp).
 *
 * WorkSafeBC: la ubicación es un best-effort; su ausencia no debe
 * bloquear el heartbeat porque lo crítico es saber que la persona
 * está viva (el timestamp), no dónde está exactamente.
 */
function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null), // permiso denegado o error → null, no falla el heartbeat
      { timeout: 5000, maximumAge: 60000 }
    );
  });
}

/**
 * Obtiene el porcentaje de batería del dispositivo (best-effort).
 * La Battery API no está en todos los navegadores; si no existe,
 * retorna null — el heartbeat sin batería es válido.
 */
async function getBatteryPct(): Promise<number | null> {
  try {
    if (typeof navigator === "undefined" || !("getBattery" in navigator)) return null;
    const battery = await (navigator as Navigator & { getBattery(): Promise<{ level: number }> }).getBattery();
    return Math.round(battery.level * 100);
  } catch {
    return null;
  }
}

/**
 * Construye y valida el payload del heartbeat. Si los datos son inválidos
 * (ej. equipo_id vacío), lanza — el llamador debe atraparlo y no seguir
 * enviando heartbeats corruptos.
 */
async function buildHeartbeatPayload(equipoId: string): Promise<HeartbeatPayload> {
  const [loc, bateria] = await Promise.all([getCurrentPosition(), getBatteryPct()]);

  return HeartbeatPayloadSchema.parse({
    equipo_id: equipoId,
    lat: loc?.lat ?? 0,
    lng: loc?.lng ?? 0,
    bateria_pct: bateria ?? 100,
  });
}

/**
 * Envía un heartbeat al servidor.
 *
 * - Si hay red, lo envía directo vía fetch a /api/employee/heartbeat.
 * - Si no hay red, lo encola en la cola offline (mismo mecanismo de
 *   offline-sync-client.ts) para que se envíe en el próximo sync.
 * - Un fallo de validación Zod lanza — no se encola un payload inválido.
 *
 * @param equipoId - ID del equipo (o empleado individual si va solo) en campo.
 * @returns true si se envió directo, false si se encoló.
 */
export async function sendHeartbeat(equipoId: string): Promise<{ sent: boolean; queued: boolean }> {
  const payload = await buildHeartbeatPayload(equipoId);

  try {
    const res = await fetch("/api/employee/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (res.ok) return { sent: true, queued: false };
    // Rechazo del servidor (ej. equipo_id inválido): no encolar.
    return { sent: false, queued: false };
  } catch {
    // Fallo de red real: encolar para reintento.
    await enqueueServiceEvent({
      localId: `heartbeat-${equipoId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orderId: "heartbeat", // no atado a una orden de servicio
      eventType: "generic_report",
      payload: {
        endpoint: "/api/employee/heartbeat",
        body: payload as unknown as Record<string, unknown>,
      },
      capturedAtIso: new Date().toISOString(),
    });
    return { sent: false, queued: true };
  }
}

/**
 * Arranca el intervalo de heartbeat en la PWA.
 *
 * - Envía un heartbeat inmediatamente al iniciar.
 * - Luego repite cada HEARTBEAT_INTERVAL_MS (5 min).
 * - Es idempotente: si ya hay un intervalo corriendo, lo detiene antes
 *   de arrancar uno nuevo.
 * - Solo se ejecuta en el navegador (usa `typeof window`).
 *
 * WorkSafeBC BC OHS 4.22: el heartbeat es la única forma que tiene el
 * sistema de saber que un trabajador en aislamiento sigue activo. No
 * debe desactivarse durante el turno.
 *
 * @param equipoId - ID del equipo o empleado en campo.
 */
export function startHeartbeat(equipoId: string): void {
  if (typeof window === "undefined") return;

  // Idempotente: detener cualquier intervalo previo.
  stopHeartbeat();

  // Primer heartbeat inmediato.
  void sendHeartbeat(equipoId);

  // Intervalo regular.
  heartbeatIntervalId = setInterval(() => {
    void sendHeartbeat(equipoId);
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Detiene el intervalo de heartbeat. Seguro llamar aunque no esté corriendo.
 * Debe llamarse al finalizar el turno del empleado.
 */
export function stopHeartbeat(): void {
  if (heartbeatIntervalId !== null) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

// ---------------------------------------------------------------------------
// Server-side: heartbeat gap detection
// ---------------------------------------------------------------------------

/**
 * Evalúa si un empleado/equipo ha excedido la ventana de silencio máximo.
 *
 * Esta función se ejecuta del lado del servidor (cron job o Supabase Edge
 * Function) consultando la tabla `pwa_heartbeats`.
 *
 * WorkSafeBC: si `minutesSinceLastHeartbeat > HEARTBEAT_MISSING_MINUTES`,
 * se debe generar una alerta inmediata al admin con la última ubicación
 * conocida. El admin decide si llama al empleado, envía ayuda, o escala
 * a emergencias.
 *
 * @param lastHeartbeatAtIso - ISO 8601 del último heartbeat registrado.
 * @param nowIso - ISO 8601 del momento actual (inyectado para testeabilidad).
 * @returns true si se debe disparar la alerta de heartbeat perdido.
 */
export function isHeartbeatMissing(
  lastHeartbeatAtIso: string | null,
  nowIso: string
): boolean {
  if (!lastHeartbeatAtIso) return true; // nunca hubo heartbeat → missing inmediato
  const last = new Date(lastHeartbeatAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const elapsedMinutes = (now - last) / (1000 * 60);
  return elapsedMinutes > HEARTBEAT_MISSING_MINUTES;
}

/**
 * Construye la alerta de heartbeat perdido para el admin.
 *
 * @param equipoId - ID del equipo/empleado.
 * @param lastHeartbeatAtIso - ISO 8601 del último heartbeat.
 * @param lastKnownLat - Última latitud conocida.
 * @param lastKnownLng - Última longitud conocida.
 * @param bateriaPct - Último porcentaje de batería conocido.
 * @param nowIso - ISO 8601 actual.
 * @returns La alerta lista para enviar al admin.
 */
export function buildMissingHeartbeatAlert(
  equipoId: string,
  lastHeartbeatAtIso: string,
  lastKnownLat: number,
  lastKnownLng: number,
  bateriaPct: number | null,
  nowIso: string
): HeartbeatMissingAlert {
  const last = new Date(lastHeartbeatAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const missingMinutes = Math.round((now - last) / (1000 * 60));

  return HeartbeatMissingAlertSchema.parse({
    equipo_id: equipoId,
    lastHeartbeatAtIso,
    lastKnownLat,
    lastKnownLng,
    missingMinutes,
    bateria_pct: bateriaPct,
  });
}

/**
 * Publica una alerta de heartbeat perdido en el canal Realtime de Supabase
 * para que el Command Center del admin la reciba en tiempo real.
 *
 * Nota: esta función requiere el contexto del servidor (service_role key).
 * En el cliente, las alertas se reciben vía subscribeToHeartbeatAlerts().
 *
 * @param alert - La alerta construida por buildMissingHeartbeatAlert().
 */
export async function publishHeartbeatAlert(alert: HeartbeatMissingAlert): Promise<void> {
  await supabase.channel(HEARTBEAT_ALERT_CHANNEL).send({
    type: "broadcast",
    event: "heartbeat_missing",
    payload: alert,
  });
}

/**
 * Suscribe al admin a las alertas de heartbeat perdido en tiempo real.
 *
 * @param onAlert - Callback que recibe cada alerta de heartbeat perdido.
 * @returns Función para desuscribirse (unsubscribe).
 */
export function subscribeToHeartbeatAlerts(
  onAlert: (alert: HeartbeatMissingAlert) => void
): () => void {
  const channel = supabase.channel(HEARTBEAT_ALERT_CHANNEL);

  channel.on("broadcast", { event: "heartbeat_missing" }, (event) => {
    const parsed = HeartbeatMissingAlertSchema.safeParse(event.payload);
    if (parsed.success) {
      onAlert(parsed.data);
    }
  });

  void channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
