"use client";

import { useEffect } from "react";
import { attachOfflineSyncListeners } from "@/lib/offline-sync-client";

/**
 * v8.3 E4 — Registra el service worker SOLO dentro de /empleado. Se hace
 * scoped a propósito: el sitio público (cotizador, marketing) no necesita
 * ni debe cachear nada offline — solo la app de campo del equipo.
 * También engancha el sync automático de la cola offline (D.10 excepción 1).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // Fix (auditoría externa 2026-07-24): el scope registrado era "/"
    // (todo el dominio), aunque el comentario de este archivo siempre dijo
    // que el SW es solo para /empleado -- en la práctica ya estaba mitigado
    // porque public/sw.js filtra por pathname (ver isAppShellRequest /
    // APP_SHELL_PREFIX en ese archivo), pero el registro debe reflejar la
    // intención real. sw.js se sirve como estático desde la raíz (/sw.js),
    // así que el scope máximo permitido por el navegador es "/" -- pedir un
    // scope MÁS ANGOSTO ("/empleado", subconjunto de "/") es válido sin
    // necesidad de mover el archivo ni de agregar el header
    // Service-Worker-Allowed (ese header solo hace falta para pedir un scope
    // MÁS AMPLIO que el directorio del script, no más angosto).
    //
    // Fix (auditoría 2026-07-30, confirmado real): lo anterior asumía que
    // las páginas de la app de empleado viven en /empleado/*, pero con
    // next-intl (localePrefix: "always") la URL real SIEMPRE lleva el
    // locale primero -- /es/empleado/... o /en/empleado/.... El scope
    // "/empleado" del navegador solo controla páginas cuyo PATH empiece
    // literalmente con "/empleado"; /es/empleado/dashboard queda fuera de
    // ese scope y el navegador nunca deja que este service worker la
    // controle (sw.js nunca recibe sus eventos "fetch"), así que el cacheo
    // offline quedaba roto en silencio para el único locale que existe hoy.
    // sw.js ya soporta el prefijo de locale correctamente (usa
    // pathname.includes(APP_SHELL_PREFIX), no startsWith -- ver ese
    // archivo), así que el único cambio necesario acá es volver a registrar
    // con scope "/" (el máximo permitido, dado que el script se sirve desde
    // la raíz) para que el control alcance a /{locale}/empleado/*.
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        console.error("SW registration failed:", err);
      });

    attachOfflineSyncListeners();
  }, []);

  return null;
}
