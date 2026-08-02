"use client";

import React, { useState, useMemo } from "react";
import { Lock, AlertTriangle, X, Loader2 } from "lucide-react";
import {
  CHEMICAL_CODES,
  detectHazard,
  type ChemicalCode,
} from "@/lib/chemical-lockout";
import { useFocusTrap } from "@/hooks/useFocusTrap";

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
 *
 * Fix (auditoría en vivo 2026-08-01): este modal (crítico -- alerta de
 * riesgo de gas cloro al mezclar químicos incompatibles) mostraba
 * `code.textEs` en vez de `code.textEn`, y todos los demás textos/labels
 * estaban hardcodeados en español, mientras el resto del portal de
 * empleado está en inglés. chemical-lockout.ts ya define textEn
 * específicamente para esto (ver línea ~24) -- simplemente no se usaba
 * aquí. Se cambia a textEn y se traduce el resto del texto visible.
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
        `CHLORINE GAS RISK: ${code.textEn} is incompatible with a product already confirmed today. Do not use it in any zone until you ventilate and check with your lead.`
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
            "CHLORINE GAS RISK: this product is incompatible with one already confirmed today. Do not use it in any zone until you ventilate and check with your lead."
        );
        return;
      }

      setHazard(false);
      setWrongAttempts((n) => n + 1);
      setError(
        data.error || "That's not the correct product for this zone. Check the label on the physical container."
      );
    } catch {
      setError("Network error confirming. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="What product are you using here?"
        className="bg-white rounded-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-amber-800">
            <Lock className="w-5 h-5" />
            <h2 className="text-base font-bold">What product are you using here?</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Zone: <span className="font-semibold text-brand-ink">{zoneLabel}</span>. Pick the container
          that matches by checking its color, icon, AND text — don&apos;t guess by color alone.
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
            If you&apos;re not sure, ask your team lead for help before trying again.
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
                // #17: ícono decorativo -- el nombre del producto ya está en
                // texto visible justo debajo (textEs/product), se oculta de
                // lectores de pantalla para no anunciar el emoji crudo sin
                // contexto (ej. "toilet emoji") en cada una de las 6 opciones.
                <div className="text-xl mb-1" aria-hidden="true">{code.icon}</div>
              )}
              <div className="text-xs font-bold leading-tight">{code.textEn}</div>
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
            Understood, I&apos;ll check with my lead
          </button>
        )}
      </div>
    </div>
  );
}
