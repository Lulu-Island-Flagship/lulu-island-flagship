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

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        console.error("SW registration failed:", err);
      });

    attachOfflineSyncListeners();
  }, []);

  return null;
}
