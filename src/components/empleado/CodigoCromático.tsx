"use client";

import React from "react";
import { CheckCircle2 } from "lucide-react";
import { CHEMICAL_CODES, type ChemicalCode } from "@/lib/chemical-lockout";

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
   * Solo LECTURA (E4, B.2.8): esto es la tabla de referencia del código
   * cromático, nunca un lugar para desbloquear zonas. El desbloqueo real
   * ocurre exclusivamente en ChemicalMatchModal.tsx (vía ChecklistCierre),
   * donde el empleado debe identificar el producto correcto para una zona
   * SIN que la respuesta esté pre-mostrada. Este componente antes tenía un
   * botón "Confirm" que mutaba el mismo `confirmedColors` compartido con la
   * tarjeta ya mostrando la respuesta correcta -- era un atajo real para
   * saltarse el candado químico por completo. Se quitó a propósito.
   */
  confirmedColors?: ReadonlySet<string>;
}

export function CodigoCromático({ compact = false, confirmedColors }: CodigoCromáticoProps) {

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
            {confirmedColors && isConfirmed && (
              <div className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-state-success">
                <CheckCircle2 className="w-5 h-5" />
                Confirmed
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
