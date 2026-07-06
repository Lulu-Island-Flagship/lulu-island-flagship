"use client";

import React from "react";
import { CalendarDays } from "lucide-react";

interface StepRecencyProps {
  days: number;
  onChange: (value: number) => void;
}

// NUNCA mostrar multiplicadores internos al cliente
const PRESETS = [
  { label: "Less than 30 days", days: 14, hint: "Recent maintenance" },
  { label: "1–2 months", days: 45, hint: "Some buildup expected" },
  { label: "2–3 months", days: 75, hint: "Moderate buildup" },
  { label: "More than 3 months", days: 120, hint: "Deep clean recommended" },
];

export function StepRecency({ days, onChange }: StepRecencyProps) {
  const selectedPreset = PRESETS.find((p) => {
    if (p.label === "Less than 30 days") return days < 30;
    if (p.label === "1–2 months") return days >= 30 && days < 60;
    if (p.label === "2–3 months") return days >= 60 && days < 90;
    return days >= 90;
  }) ?? PRESETS[3];

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">
          When was your last professional cleaning?
        </h2>
        <p className="text-gray-600">
          More time since the last deep clean means more buildup to tackle.
        </p>
      </div>

      <div className="bg-brand-ice rounded-lg p-6">
        <div className="flex items-center gap-3 mb-6">
          <CalendarDays className="w-5 h-5 text-brand-wave-blue" />
          <div>
            <h3 className="font-semibold text-brand-ink">Approximate time since last cleaning</h3>
            <p className="text-sm text-gray-500">Best estimate is fine</p>
          </div>
        </div>

        <input
          type="range"
          min="0"
          max="180"
          step="5"
          value={days}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-gold"
        />
        <div className="flex justify-between mt-2 text-sm text-gray-500">
          <span>Just cleaned</span>
          <span className="font-semibold text-brand-ink text-lg">
            {days < 30
              ? `${days} days`
              : days < 60
              ? `${Math.round(days / 30)} month`
              : `${Math.round(days / 30)} months`}
          </span>
          <span>6+ months</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRESETS.map((preset) => {
          const isSelected = selectedPreset.label === preset.label;
          return (
            <button
              key={preset.label}
              onClick={() => onChange(preset.days)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                isSelected
                  ? "border-brand-gold bg-brand-gold/10"
                  : "border-gray-200 hover:border-brand-wave-blue"
              }`}
            >
              <div className="flex flex-col">
                <span className="font-medium">{preset.label}</span>
                <span className="text-sm text-gray-500 mt-1">{preset.hint}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
