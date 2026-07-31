/**
 * v8.3 E4 — Service worker mínimo (sin dependencias externas, para no
 * arriesgar romper el build con un paquete que no se pudo probar aquí).
 *
 * Estrategia:
 *  - App shell del empleado (HTML/JS/CSS de /[locale]/empleado/*): cache-first
 *    con fallback a red, así carga sin señal.
 *  - Todo lo demás (APIs, imágenes de otros clientes): network-first normal,
 *    el service worker no interfiere.
 *  - La cola de escritura offline (t_in/t_start/t_out/foto/nota) vive en
 *    IndexedDB, manejada por offline-queue.ts en el hilo principal — el
 *    service worker solo cachea lectura de la app shell, no intenta
 *    reinventar sync de escritura (eso requiere Background Sync API, que no
 *    todos los navegadores soportan de forma confiable; el approach de
 *    "reintentar al recuperar conexión" desde el propio cliente es más
 *    portable y ya cubre el requisito D.10 excepción 1).
 */

const CACHE_NAME = "lulu-empleado-shell-v1";
const APP_SHELL_PREFIX = "/empleado";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Nota (auditoría 2026-07-30): las URLs reales de la app de empleado llevan
// locale primero (/es/empleado/*, /en/empleado/*, next-intl con
// localePrefix: "always"). Se usa .includes() a propósito (no
// .startsWith()) para que esto matchee sin importar el locale -- eso ya
// estaba bien acá; lo que estaba roto era el `scope` del registro en
// ServiceWorkerRegister.tsx ("/empleado", que el navegador nunca aplica a
// /es/empleado/*), corregido por separado a scope "/".
function isAppShellRequest(url) {
  return url.pathname.includes(APP_SHELL_PREFIX) && !url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nunca interceptar llamadas a la API — esas siempre deben ir a la red
  // (o fallar explícitamente, para que offline-queue.ts las encole).
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (event.request.method !== "GET") {
    return;
  }

  if (isAppShellRequest(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request)
            .then((response) => {
              if (response && response.status === 200) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            .catch(() => cached); // sin red: devuelve lo cacheado si existe

          return cached || networkFetch;
        })
      )
    );
  }
});
