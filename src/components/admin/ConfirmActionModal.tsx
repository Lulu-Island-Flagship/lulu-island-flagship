"use client";

/**
 * 2026-07-24 — Auditoría "browser prompt() en flujos admin sensibles":
 * window.prompt/confirm no son accesibles, no se pueden estilizar, se
 * bloquean con popup blockers en algunos navegadores/entornos embebidos,
 * y no dejan constancia visual de qué se está confirmando (grave en el
 * caso de la firma digital de contract-reviews). Este modal reemplaza
 * los 11 usos de window.prompt/confirm en el admin por un único
 * componente reusable: confirmación simple (sin `fields`) o confirmación
 * + captura de uno o más campos de texto (razón, referencia, monto,
 * nombre para firma) antes de ejecutar la acción.
 *
 * Uso: el `onConfirm` recibe los valores de los `fields` (por su `key`)
 * y debe hacer el fetch/lógica de negocio. Si lanza un Error, el modal
 * muestra el mensaje y permanece abierto (el usuario puede reintentar).
 * Si resuelve sin error, es responsabilidad del componente padre cerrar
 * el modal (normalmente limpiando el estado que lo renderiza) dentro de
 * ese mismo onConfirm, tras el await.
 */

import React, { useState } from "react";
import { Loader2, AlertTriangle, X } from "lucide-react";

export interface ConfirmActionField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number";
  required?: boolean;
  /** Texto de ayuda bajo el input (p.ej. "Opcional") */
  helperText?: string;
  autoFocus?: boolean;
}

export interface ConfirmActionModalProps {
  title: string;
  /** Mensaje / descripción de la acción a confirmar. */
  message?: React.ReactNode;
  /**
   * Aviso legal opcional destacado (p.ej. "Escribir el nombre completo
   * constituye una firma digital vinculante"). Se muestra en un recuadro
   * ámbar distinto del mensaje normal.
   */
  noticeText?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Estiliza el botón de confirmar en rojo para acciones destructivas. */
  danger?: boolean;
  /** Si se omite, el modal es una confirmación simple sí/no. */
  fields?: ConfirmActionField[];
  onConfirm: (values: Record<string, string>) => Promise<void> | void;
  onCancel: () => void;
}

export default function ConfirmActionModal({
  title,
  message,
  noticeText,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  fields,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((fields || []).map((f) => [f.key, ""]))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const missingRequired = (fields || []).some(
    (f) => f.required !== false && !values[f.key]?.trim()
  );

  async function handleConfirm() {
    if (missingRequired) return;
    setLoading(true);
    setError("");
    try {
      await onConfirm(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      setLoading(false);
    }
    // No `finally` clearing loading on success: on success the parent is
    // expected to unmount this modal, so no further render is needed.
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-elevation-3 max-w-md w-full p-6 relative">
        <button
          aria-label="Cerrar"
          onClick={onCancel}
          disabled={loading}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-bold text-brand-ink mb-2 pr-6">{title}</h2>

        {message && <p className="text-gray-600 text-sm mb-4">{message}</p>}

        {noticeText && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{noticeText}</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {fields && fields.length > 0 && (
          <div className="space-y-3 mb-4">
            {fields.map((f) => (
              <div key={f.key}>
                <label
                  htmlFor={`confirm-action-field-${f.key}`}
                  className="block text-sm font-medium text-brand-ink mb-1"
                >
                  {f.label}
                  {f.required === false && (
                    <span className="text-gray-400 font-normal"> (optional)</span>
                  )}
                </label>
                <input
                  id={`confirm-action-field-${f.key}`}
                  type={f.type || "text"}
                  autoFocus={f.autoFocus}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  disabled={loading}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none disabled:opacity-50"
                />
                {f.helperText && <p className="text-xs text-gray-500 mt-1">{f.helperText}</p>}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || missingRequired}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-semibold text-white transition-colors disabled:opacity-50 ${
              danger
                ? "bg-state-danger hover:bg-state-danger/90"
                : "bg-brand-navy hover:bg-brand-navy-light"
            }`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
