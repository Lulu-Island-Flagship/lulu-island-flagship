"use client";

import React from "react";

interface ColorCode {
  color: string;
  bgClass: string;
  icon: string;
  label: string;
  text: string;
  zones: string;
  risk: string;
}

const COLOR_CODES: ColorCode[] = [
  {
    color: "red",
    bgClass: "bg-red-100 border-red-300 text-red-800",
    icon: "🚽",
    label: "BAÑO — ÁCIDO",
    text: "Bathroom — Acid",
    zones: "Toilets, sinks, showers",
    risk: "NEVER mix with BLUE (ammonia) → chlorine gas",
  },
  {
    color: "blue",
    bgClass: "bg-blue-100 border-blue-300 text-blue-800",
    icon: "🍳",
    label: "COCINA — AMONIO",
    text: "Kitchen — Alkaline",
    zones: "Stove, hood, countertops",
    risk: "NEVER mix with RED (acid) → chlorine gas",
  },
  {
    color: "green",
    bgClass: "bg-green-100 border-green-300 text-green-800",
    icon: "✨",
    label: "NEUTRO",
    text: "Neutral — All surfaces",
    zones: "Countertops, furniture, dusting",
    risk: "Safe with all colors",
  },
  {
    color: "yellow",
    bgClass: "bg-yellow-100 border-yellow-300 text-yellow-800",
    icon: "🪵",
    label: "MADERA",
    text: "Wood — Polish",
    zones: "Wood furniture, cabinets",
    risk: "NEVER on floors (slippery)",
  },
  {
    color: "white",
    bgClass: "bg-gray-100 border-gray-300 text-gray-800",
    icon: "🪟",
    label: "CRISTAL",
    text: "Glass — Windows",
    zones: "Windows, mirrors, glass",
    risk: "Glass only",
  },
  {
    color: "black",
    bgClass: "bg-gray-800 border-gray-600 text-white",
    icon: "🧹",
    label: "PISO",
    text: "Floor — pH Neutral",
    zones: "All floor types",
    risk: "Never on countertops or wood",
  },
];

interface CodigoCromáticoProps {
  compact?: boolean;
}

export function CodigoCromático({ compact = false }: CodigoCromáticoProps) {
  if (compact) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {COLOR_CODES.map((cc) => (
          <div
            key={cc.color}
            className={`rounded-lg border p-2 text-center ${cc.bgClass}`}
          >
            <div className="text-xl mb-0.5">{cc.icon}</div>
            <div className="text-xs font-bold leading-tight">{cc.label}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {COLOR_CODES.map((cc) => (
        <div
          key={cc.color}
          className={`rounded-lg border p-3 flex items-center gap-3 ${cc.bgClass}`}
        >
          <div className="text-2xl">{cc.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm">{cc.label}</div>
            <div className="text-xs opacity-80">{cc.text}</div>
            <div className="text-xs mt-0.5">Zones: {cc.zones}</div>
            {cc.risk && (
              <div className="text-xs mt-1 font-medium opacity-90">⚠️ {cc.risk}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
