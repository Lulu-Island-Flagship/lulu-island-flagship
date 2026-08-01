/**
 * v8.3 E4 (D.10 excepción #1) — Cola de escritura offline.
 * "Pérdida de conectividad → guardado local silencioso, sync automático;
 * datos de sensor = evidencia. No bloqueante."
 *
 * Diseño en dos capas, a propósito:
 *  - Funciones PURAS (esta parte, testeable sin navegador): deciden qué
 *    hacer con un item de la cola — reintentar, descartar, marcar en
 *    conflicto — sin tocar IndexedDB directamente.
 *  - Wrapper de IndexedDB (abajo, no testeable con node:test porque
 *    requiere el navegador): solo mueve bytes, no decide nada.
 */

// Fix (auditoría 2026-07-31, #6): "generic_report" cubre formularios que NO
// están atados a un order (near-miss, incidente laboral, reporte de
// enfermedad) -- antes esta cola solo servía a los eventos de un servicio
// específico (t_in/t_start/t_out/photo/note, todos con orderId real). Estos
// reportes usan orderId="_generic" (placeholder, ver GENERIC_QUEUE_ORDER_ID
// abajo) porque QueuedServiceEvent.orderId es requerido mas no aplica --
// nada en este archivo ni en offline-sync-client.ts filtra por orderId
// salvo la pantalla de un servicio puntual (servicio/[orderId]/page.tsx),
// que nunca ve estos eventos porque su orderId real nunca es "_generic".
export type QueuedEventType = "t_in" | "t_start" | "t_out" | "photo" | "note" | "generic_report";

export const GENERIC_QUEUE_ORDER_ID = "_generic";

export interface QueuedServiceEvent {
  /** id local (uuid generado en el cliente, no el id del servidor) */
  localId: string;
  orderId: string;
  eventType: QueuedEventType;
  payload: Record<string, unknown>;
  /** timestamp de cuando el empleado hizo la acción, NO de cuando se sincroniza */
  capturedAtIso: string;
  attempts: number;
  lastAttemptAtIso: string | null;
  lastError: string | null;
}

export const MAX_SYNC_ATTEMPTS = 8;

/**
 * Backoff exponencial simple con techo: 5s, 10s, 20s... hasta 5 min.
 * Evita machacar el servidor apenas vuelve la señal si hay muchos items.
 */
export function nextRetryDelayMs(attempts: number): number {
  const base = 5000;
  const capped = Math.min(attempts, 6); // 5*2^6 = 320s, cerca del techo de 5 min
  return Math.min(base * Math.pow(2, capped), 5 * 60 * 1000);
}

/** ¿Ya se puede reintentar este item, dado cuándo fue el último intento? */
export function isReadyForRetry(
  item: QueuedServiceEvent,
  nowIso: string
): boolean {
  if (!item.lastAttemptAtIso) return true;
  const last = new Date(item.lastAttemptAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const delay = nextRetryDelayMs(item.attempts);
  return now - last >= delay;
}

/** ¿Se agotaron los reintentos? A partir de aquí se marca para revisión manual, nunca se borra silenciosamente. */
export function hasExhaustedRetries(item: QueuedServiceEvent): boolean {
  return item.attempts >= MAX_SYNC_ATTEMPTS;
}

/**
 * Decide qué hacer con la cola completa en este ciclo de sync.
 * Nunca descarta datos — un item "agotado" pasa a needsManualReview, no se borra.
 */
export interface SyncPlan {
  toSync: QueuedServiceEvent[];
  needsManualReview: QueuedServiceEvent[];
  waiting: QueuedServiceEvent[];
}

export function planSync(queue: QueuedServiceEvent[], nowIso: string): SyncPlan {
  const toSync: QueuedServiceEvent[] = [];
  const needsManualReview: QueuedServiceEvent[] = [];
  const waiting: QueuedServiceEvent[] = [];

  for (const item of queue) {
    if (hasExhaustedRetries(item)) {
      needsManualReview.push(item);
    } else if (isReadyForRetry(item, nowIso)) {
      toSync.push(item);
    } else {
      waiting.push(item);
    }
  }

  // Orden de sync: por tipo de evento primero (t_in antes que t_out, etc.)
  // para respetar la secuencia que el servidor valida, luego por captura.
  const eventOrder: Record<QueuedEventType, number> = {
    t_in: 0, t_start: 1, photo: 2, note: 3, t_out: 4, generic_report: 5,
  };
  toSync.sort((a, b) => {
    const byOrder = eventOrder[a.eventType] - eventOrder[b.eventType];
    if (byOrder !== 0) return byOrder;
    return new Date(a.capturedAtIso).getTime() - new Date(b.capturedAtIso).getTime();
  });

  return { toSync, needsManualReview, waiting };
}

// ------------------------------------------------------------
// Wrapper de IndexedDB (solo se ejecuta en el navegador — no se testea con
// node:test, que es por lo que el diseño de arriba lo aísla)
// ------------------------------------------------------------

const DB_NAME = "lulu_offline_queue";
const DB_VERSION = 1;
const STORE_NAME = "service_events";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueServiceEvent(
  event: Omit<QueuedServiceEvent, "attempts" | "lastAttemptAtIso" | "lastError">
): Promise<void> {
  const db = await openDb();
  const full: QueuedServiceEvent = { ...event, attempts: 0, lastAttemptAtIso: null, lastError: null };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllQueuedEvents(): Promise<QueuedServiceEvent[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueuedServiceEvent[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueuedEvent(localId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markAttempt(localId: string, error: string | null, nowIso: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(localId);
    getReq.onsuccess = () => {
      const item = getReq.result as QueuedServiceEvent | undefined;
      if (!item) {
        resolve();
        return;
      }
      item.attempts += 1;
      item.lastAttemptAtIso = nowIso;
      item.lastError = error;
      store.put(item);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Ejecuta un ciclo de sync completo: intenta enviar cada item listo con
 * `sendFn`; si tiene éxito lo borra de la cola, si falla lo marca con el
 * error para el próximo backoff. Se llama al recuperar conexión (evento
 * 'online') y en un intervalo de respaldo.
 */
export async function runSyncCycle(
  sendFn: (event: QueuedServiceEvent) => Promise<{ ok: boolean; error?: string }>
): Promise<{ synced: number; failed: number; needsManualReview: number }> {
  const now = new Date().toISOString();
  const queue = await getAllQueuedEvents();
  const plan = planSync(queue, now);

  let synced = 0;
  let failed = 0;

  for (const item of plan.toSync) {
    try {
      const result = await sendFn(item);
      if (result.ok) {
        await removeQueuedEvent(item.localId);
        synced += 1;
      } else {
        await markAttempt(item.localId, result.error || "unknown error", now);
        failed += 1;
      }
    } catch (err) {
      await markAttempt(item.localId, err instanceof Error ? err.message : "network error", now);
      failed += 1;
    }
  }

  return { synced, failed, needsManualReview: plan.needsManualReview.length };
}
