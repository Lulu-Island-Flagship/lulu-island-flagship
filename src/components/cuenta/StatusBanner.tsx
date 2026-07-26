"use client";

import React, { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

interface StatusBannerProps {
  /** "error" pinta rojo con AlertCircle; "success" pinta verde con CheckCircle2. */
  variant: "error" | "success";
  /** Mensaje a mostrar. Si está vacío/null/undefined, el banner no renderiza nada. */
  message: string | null | undefined;
  /** Acción opcional de reintento (ej. re-disparar el mismo fetch que falló). */
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  /** Botón de cerrar opcional (X). Si se pasa junto con autoDismissMs, también se usa para el auto-dismiss. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Si se pasa junto con onDismiss, el banner se auto-cierra tras N ms (pensado para mensajes de éxito). */
  autoDismissMs?: number;
  className?: string;
}

/**
 * Banner de estado reusable para el área de cliente (/cuenta). Cubre tanto
 * error (rojo, con reintento opcional) como éxito (verde, con auto-dismiss
 * opcional) para no tener dos componentes separados en un área con pocos
 * puntos de guardado. Inline, junto a la acción -- no es una librería de
 * toasts flotantes.
 */
export function StatusBanner({
  variant,
  message,
  onRetry,
  retrying,
  retryLabel,
  onDismiss,
  dismissLabel,
  autoDismissMs,
  className = "",
}: StatusBannerProps) {
  // Fix (auditoría UX 2026-07-25): "Retry"/"Dismiss"/"Retrying…" eran
  // fallbacks hardcodeados en inglés -- un cliente navegando en fr/zh que
  // llegara a un caller sin retryLabel/dismissLabel explícito (o al estado
  // "retrying", que no tenía prop de override) veía texto en inglés en medio
  // de una UI ya traducida. Se usan claves i18n obligatorias como default en
  // vez de literales en inglés.
  const tCommon = useTranslations("cuenta.common");
  const resolvedRetryLabel = retryLabel ?? tCommon("retry");
  const resolvedDismissLabel = dismissLabel ?? tCommon("dismiss");
  const resolvedRetryingLabel = tCommon("retrying");

  useEffect(() => {
    if (variant === "success" && message && autoDismissMs && onDismiss) {
      const timer = setTimeout(onDismiss, autoDismissMs);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [variant, message, autoDismissMs, onDismiss]);

  if (!message) return null;

  const isError = variant === "error";
  const styles = isError
    ? "bg-red-50 border-red-200 text-red-700"
    : "bg-green-50 border-green-200 text-green-700";
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`border rounded-xl p-4 flex items-start gap-3 ${styles} ${className}`}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 text-sm">
        <p>{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold underline disabled:opacity-50"
          >
            {retrying && <Loader2 className="w-3 h-3 animate-spin" />}
            {retrying ? resolvedRetryingLabel : resolvedRetryLabel}
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label={resolvedDismissLabel}
          onClick={onDismiss}
          className="shrink-0 opacity-60 hover:opacity-100"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
