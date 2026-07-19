"use client";

import React, { useState, useMemo } from "react";
import { Lock, AlertTriangle, X, Loader2 } from "lucide-react";
import {
  CHEMICAL_CODES,
  detectHazard,
  type ChemicalCode,
} from "@/lib/chemical-lockout";

/**
 * v8.3 E4 (D.5 + B.2.8) — Reemplaza el "confirmar" de un solo toque que
 * mostraba la respuesta correcta en la misma tarjeta (bug real: la UI
 * anterior armaba selectedColor/selectedIcon/selectedText copiándolos del
 * MISMO code que se estaba confirmando, así que la validación de 3 señales
 * siempre pasaba sin que el empleado leyera nada).
 *
 * Ahora: se muestra solo la ZONA (nunca el color correcto), y el empleado
 * debe identificar el producto correcto entre las 6 opciones en orden
 * aleatorio -- igual que tendría que leer la etiqueta física del envase.
 * Si el intento fallido forma el par incompatible rojo+azul con un color
 * ya confirmado hoy, se bloquea con la alerta de riesgo de gas cloro
 * (poka-yoke real, detectHazard ya no es código muerto).
 */

const BG_CLASS: Record<ChemicalCode["color"], string> = {
  red: "bg-red-100 border-red-300 text-red-800 hover:bg-red-200",
  blue: "bg-blue-100 border-blue-300 text-blue-800 hover:bg-blue-200",
  green: "bg-green-100 border-green-300 text-green-800 hover:bg-green-200",
  yellow: "bg-yellow-100 border-yellow-300 text-yellow-800 hover:bg-yellow-200",
  white: "bg-gray-100 border-gray-300 text-gray-800 hover:bg-gray-200",
  black: "bg-gray-800 border-gray-600 text-white hover:bg-gray-700",
};

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

interface ChemicalMatchModalProps {
  orderId: string;
  zoneColor: string;
  zoneLabel: string;
  confirmedColors: ReadonlySet<string>;
  onConfirmed: (next: Set<string>) => void;
  onClose: () => void;
}

export function ChemicalMatchModal({
  orderId,
  zoneColor,
  zoneLabel,
  confirmedColors,
  onConfirmed,
  onClose,
}: ChemicalMatchModalProps) {
  const shuffledCodes = useMemo(() => shuffle(CHEMICAL_CODES), []);
  const [error, setError] = useState<string | null>(null);
  const [hazard, setHazard] = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // v8.3 E4 fix (auditoría 2026-07-18): la validación local con
  // detectHazard()/applyConfirmation() era solo una preview de UI. La
  // fuente de verdad real es POST /api/empleado/chemical-confirm, que
  // vuelve a correr las mismas funciones puras server-side y persiste la
  // confirmación en chemical_zone_confirmations — sin esa fila, el
  // servidor rechaza is_completed=true en el checklist aunque el cliente
  // haya "desbloqueado" la zona localmente.
  async function handlePick(code: ChemicalCode) {
    if (submitting) return;

    const localHazard = detectHazard(code.color, confirmedColors);
    if (localHazard.hazard) {
      setHazard(true);
      setError(
        `RIESGO DE GAS CLORO: ${code.textEs} es incompatible con un producto ya confirmado hoy. No lo uses en ninguna zona hasta ventilar y consultar a tu líder.`
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/empleado/chemical-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId,
          targetColor: zoneColor,
          selectedColor: code.color,
          selectedIcon: code.icon,
          selectedText: code.textEn,
        }),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        onConfirmed(new Set<string>(data.confirmedColors || []));
        onClose();
        return;
      }

      if (data.hazard) {
        setHazard(true);
        setError(
          data.error ||
            "RIESGO DE GAS CLORO: este producto es incompatible con uno ya confirmado hoy. No lo uses en ninguna zona hasta ventilar y consultar a tu líder."
        );
        return;
      }

      setHazard(false);
      setWrongAttempts((n) => n + 1);
      setError(
        data.error || "Ese no es el producto correcto para esta zona. Revisa la etiqueta del envase físico."
      );
    } catch {
      setError("Error de red al confirmar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-amber-800">
            <Lock className="w-5 h-5" />
            <h2 className="text-base font-bold">¿Qué producto usas aquí?</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Zona: <span className="font-semibold text-brand-ink">{zoneLabel}</span>. Elige el envase que
          corresponde revisando su color, ícono Y texto — no adivines por color solo.
        </p>

        {error && (
          <div
            className={`mb-3 p-3 rounded-lg text-xs flex items-start gap-2 ${
              hazard ? "bg-red-100 border border-red-300 text-red-800" : "bg-amber-50 border border-amber-200 text-amber-800"
            }`}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {wrongAttempts >= 3 && !hazard && (
          <div className="mb-3 p-3 rounded-lg text-xs bg-blue-50 border border-blue-200 text-blue-800">
            Si no estás seguro, pídele ayuda a tu líder de equipo antes de seguir intentando.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {shuffledCodes.map((code) => (
            <button
              key={code.color}
              type="button"
              disabled={hazard || submitting}
              onClick={() => handlePick(code)}
              className={`rounded-lg border p-3 text-left disabled:opacity-40 disabled:cursor-not-allowed ${BG_CLASS[code.color]}`}
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin mb-1" />
              ) : (
                <div className="text-xl mb-1">{code.icon}</div>
              )}
              <div className="text-xs font-bold leading-tight">{code.textEs}</div>
              <div className="text-[11px] opacity-80">{code.product}</div>
            </button>
          ))}
        </div>

        {hazard && (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full bg-red-600 text-white py-2.5 rounded-lg text-sm font-semibold"
          >
            Entendido, voy a consultar a mi líder
          </button>
        )}
      </div>
    </div>
  );
}
