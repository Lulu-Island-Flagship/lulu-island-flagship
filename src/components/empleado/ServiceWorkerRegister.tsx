"use client";

import { useEffect } from "react";

/**
 * v8.3 E4 — Registra el service worker SOLO dentro de /empleado. Se hace
 * scoped a propósito: el sitio público (cotizador, marketing) no necesita
 * ni debe cachear nada offline — solo la app de campo del equipo.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        console.error("SW registration failed:", err);
      });
  }, []);

  return null;
}
