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
import { supabase } from "@/lib/supabase";

const PHOTO_BUCKET = "service-photos";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Sube un blob de foto a Supabase Storage y devuelve la URL pública.
 * Es la parte que realmente necesita red — si falla, quien llama decide
 * si encola (D.10 #1: pérdida de conectividad, no bloqueante).
 */
async function uploadPhotoBlob(orderId: string, blob: Blob, ext: string): Promise<string> {
  const fileName = `${orderId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(fileName, blob, { contentType: blob.type || "image/webp" });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

async function sendServiceEvent(
  event: QueuedServiceEvent
): Promise<{ ok: boolean; error?: string }> {
  try {
    let payload = event.payload;

    // Evento de foto encolado offline: el blob viaja como data URL dentro
    // del payload (Blob no es JSON-serializable, IndexedDB sí lo acepta,
    // pero al reintentar por fetch necesitamos primero subirlo a Storage).
    if (event.eventType === "photo" && typeof payload.photoDataUrl === "string") {
      const blob = await dataUrlToBlob(payload.photoDataUrl);
      const ext = (payload.photoExt as string) || "webp";
      const photoUrl = await uploadPhotoBlob(event.orderId, blob, ext);
      const { photoDataUrl: _omit, photoExt: _omit2, ...rest } = payload;
      payload = { ...rest, photoUrl };
    }

    const res = await fetch("/api/empleado/servicio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        orderId: event.orderId,
        eventType: event.eventType,
        ...payload,
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
  } catch {
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

/**
 * Comprime una foto a WebP (src/lib/image-compress.ts) y la sube. Si hay
 * señal, sube directo a Storage y registra el evento (encolando el registro
 * si solo esa parte falla). Si no hay señal para nada, encola TODO —
 * incluida la foto ya comprimida como data URL — para que nunca se pierda
 * (D.10 excepción #1: "datos de sensor = evidencia").
 */
export async function submitPhotoOrQueue(
  orderId: string,
  file: File,
  extra: Record<string, unknown> = {}
): Promise<{ queued: boolean; ok: boolean; photoUrl?: string; error?: string }> {
  const { compressImageToWebP } = await import("@/lib/image-compress");

  let blob: Blob;
  try {
    const compressed = await compressImageToWebP(file);
    blob = compressed.blob;
  } catch {
    // Si la compresión falla (formato raro, navegador viejo), subimos el
    // archivo original antes que perder la evidencia.
    blob = file;
  }

  try {
    const photoUrl = await uploadPhotoBlob(orderId, blob, "webp");
    const result = await submitServiceEventOrQueue(orderId, "photo", { photoUrl, ...extra });
    return { queued: result.queued, ok: result.ok, photoUrl, error: result.error };
  } catch (e) {
    // Storage también falló por red: encolar la foto completa (data URL)
    // para reintentar más tarde, silencioso para el empleado.
    const photoDataUrl = await blobToDataUrl(blob);
    await enqueueServiceEvent({
      localId: `${orderId}-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orderId,
      eventType: "photo",
      payload: { photoDataUrl, photoExt: "webp", ...extra },
      capturedAtIso: new Date().toISOString(),
    });
    return { queued: true, ok: true, error: e instanceof Error ? e.message : "network error" };
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
