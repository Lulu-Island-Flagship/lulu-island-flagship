"use client";

import React from "react";
import { CheckCircle2, Lock } from "lucide-react";
import {
  CHEMICAL_CODES,
  applyConfirmation,
  type ChemicalCode,
} from "@/lib/chemical-lockout";

const BG_CLASS: Record<ChemicalCode["color"], string> = {
  red: "bg-red-100 border-red-300 text-red-800",
  blue: "bg-blue-100 border-blue-300 text-blue-800",
  green: "bg-green-100 border-green-300 text-green-800",
  yellow: "bg-yellow-100 border-yellow-300 text-yellow-800",
  white: "bg-gray-100 border-gray-300 text-gray-800",
  black: "bg-gray-800 border-gray-600 text-white",
};

interface CodigoCromáticoProps {
  compact?: boolean;
  /**
   * Modo candado (E4): si se pasan estas props, cada tarjeta exige
   * confirmación explícita antes de mostrarse como "lista" — nunca basta con
   * ver el color, el empleado debe leer y confirmar la tarjeta completa
   * (color + ícono + texto, invariante B.2.8).
   */
  confirmedColors?: ReadonlySet<string>;
  onConfirmedColorsChange?: (next: Set<string>) => void;
}

export function CodigoCromático({
  compact = false,
  confirmedColors,
  onConfirmedColorsChange,
}: CodigoCromáticoProps) {
  const interactive = !!confirmedColors && !!onConfirmedColorsChange;

  const handleConfirm = (code: ChemicalCode) => {
    if (!confirmedColors || !onConfirmedColorsChange) return;
    // La confirmación se dispara desde el botón de ESTA tarjeta específica,
    // así que color/ícono/texto siempre corresponden entre sí — no hay forma
    // de confirmar "solo el color" con esta UI.
    const result = applyConfirmation(confirmedColors, {
      targetColor: code.color,
      selectedColor: code.color,
      selectedIcon: code.icon,
      selectedText: code.textEn,
    });
    if (result.ok) {
      onConfirmedColorsChange(result.confirmedColors);
    }
  };

  if (compact) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {CHEMICAL_CODES.map((cc) => (
          <div
            key={cc.color}
            className={`rounded-lg border p-2 text-center ${BG_CLASS[cc.color]}`}
          >
            <div className="text-xl mb-0.5">{cc.icon}</div>
            <div className="text-xs font-bold leading-tight">{cc.textEs}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {CHEMICAL_CODES.map((cc) => {
        const isConfirmed = confirmedColors?.has(cc.color) ?? false;
        return (
          <div
            key={cc.color}
            className={`rounded-lg border p-3 flex items-center gap-3 ${BG_CLASS[cc.color]}`}
          >
            <div className="text-2xl">{cc.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{cc.textEs}</div>
              <div className="text-xs opacity-80">{cc.textEn}</div>
              <div className="text-xs mt-0.5">Zona: {cc.zoneLabel} — {cc.product}</div>
              {cc.riskEn && (
                <div className="text-xs mt-1 font-medium opacity-90">⚠️ {cc.riskEn}</div>
              )}
            </div>
            {interactive && (
              <div className="flex-shrink-0">
                {isConfirmed ? (
                  <div className="flex items-center gap-1 text-xs font-semibold text-state-success">
                    <CheckCircle2 className="w-5 h-5" />
                    Confirmed
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleConfirm(cc)}
                    className="flex items-center gap-1 text-xs font-semibold bg-white border border-current rounded-lg px-2 py-2 hover:opacity-80"
                  >
                    <Lock className="w-4 h-4" />
                    Confirm
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
