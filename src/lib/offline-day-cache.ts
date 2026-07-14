/**
 * v8.3 E4 (D.10.1-2, criterio de aceptación E4 #1) — Precarga de datos de
 * jornada a IndexedDB. Complementa la cola de escritura offline
 * (offline-queue.ts, que maneja lo que el empleado ENVÍA sin red) con el
 * lado de LECTURA: la ruta del día, el SOP de cada servicio y los accesos
 * conocidos, descargados una vez al iniciar jornada para poder abrir
 * cualquier servicio sin conexión desde el punto de encuentro.
 *
 * Mismo patrón de dos capas que offline-queue.ts: el tipo del bundle es una
 * interfaz plana (testeable), el wrapper de IndexedDB de abajo no se testea
 * con node:test porque requiere el navegador.
 */

export interface DayCacheService {
  orderId: string;
  serviceTime: string;
  address: string;
  zone: string;
  serviceSubtype: string;
  squareFeet: number;
  bedrooms: number;
  bathrooms: number;
  addonZones: string[];
  myAssignedZones: string[] | null;
  keyAccess: { method: string; lockboxCode: string | null } | null;
}

export interface DayCacheBundle {
  date: string; // YYYY-MM-DD (Vancouver)
  employee: { id: string; name: string };
  downloadedAt: string;
  services: DayCacheService[];
  checklistsBySubtype: Record<string, unknown[]>;
}

/** Un servicio ya descargado se puede abrir sin red si está en el bundle de hoy. */
export function findServiceInBundle(
  bundle: DayCacheBundle | null,
  orderId: string
): DayCacheService | null {
  if (!bundle) return null;
  return bundle.services.find((s) => s.orderId === orderId) ?? null;
}

/** ¿El bundle guardado sigue siendo el de HOY? Uno de ayer no sirve para operar. */
export function isBundleFresh(bundle: DayCacheBundle | null, todayIso: string): boolean {
  if (!bundle) return false;
  return bundle.date === todayIso;
}

// ------------------------------------------------------------
// Wrapper de IndexedDB (solo navegador)
// ------------------------------------------------------------

const DB_NAME = "lulu_offline_day_cache";
const DB_VERSION = 1;
const STORE_NAME = "day_bundle";
const SINGLETON_KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Guarda el bundle del día (sobrescribe cualquier bundle previo — solo se necesita el de hoy). */
export async function saveDayCacheBundle(bundle: DayCacheBundle): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ key: SINGLETON_KEY, bundle });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDayCacheBundle(): Promise<DayCacheBundle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(SINGLETON_KEY);
    req.onsuccess = () => resolve((req.result?.bundle as DayCacheBundle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Descarga el bundle del día desde el servidor y lo guarda localmente. Se
 * llama al iniciar jornada (con red, en el punto de encuentro). Si falla
 * (sin red justo en ese momento, servidor caído), no bloquea el inicio de
 * jornada — el empleado sigue pudiendo trabajar con el bundle de una
 * descarga previa si existe, o pedir ayuda si es su primer servicio del día.
 */
export async function downloadAndCacheDayBundle(): Promise<
  { ok: true; bundle: DayCacheBundle } | { ok: false; error: string }
> {
  try {
    const res = await fetch("/api/empleado/jornada/precarga", { credentials: "include" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "unknown error" }));
      return { ok: false, error: err.error || `HTTP ${res.status}` };
    }
    const bundle = (await res.json()) as DayCacheBundle;
    await saveDayCacheBundle(bundle);
    return { ok: true, bundle };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}
