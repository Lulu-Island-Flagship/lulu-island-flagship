"use client";

import React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface ErrorBannerProps {
  /** Mensaje a mostrar. Si está vacío/null, el banner no renderiza nada. */
  message: string | null | undefined;
  /** Acción opcional de reintento (ej. re-disparar el mismo submit). */
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  className?: string;
}

/**
 * Banner de error reusable para el área de empleado. No es una librería de
 * toasts -- es un bloque inline, visible junto a la acción que falló, que se
 * queda hasta que el empleado reintenta con éxito o cambia de pantalla.
 * Usado consistentemente en: inicio de jornada, eventos de servicio
 * (T_in/T_start/T_out/foto/nota), upsells y checklist/protocolo de cierre.
 */
export function ErrorBanner({ message, onRetry, retrying, retryLabel, className = "" }: ErrorBannerProps) {
  const t = useTranslations("common");
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`bg-state-danger/10 border border-state-danger rounded-lg p-3 flex items-start gap-2 text-sm text-state-danger ${className}`}
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p>{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold underline disabled:opacity-50"
          >
            {retrying && <Loader2 className="w-3 h-3 animate-spin" />}
            {retrying ? t("retrying") : (retryLabel ?? t("retry"))}
          </button>
        )}
      </div>
    </div>
  );
}
