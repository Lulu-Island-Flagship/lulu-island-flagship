"use client";

import React from "react";

interface StepRecencyProps {
  days: number;
  onChange: (value: number) => void;
}

// NUNCA mostrar multiplicadores internos al cliente
const PRESETS = [
  { label: "Less than 30 days", days: 14, hint: "Recent maintenance", rangeMax: 29 },
  { label: "1–2 months", days: 45, hint: "Some buildup expected", rangeMax: 59 },
  { label: "2–3 months", days: 75, hint: "Moderate buildup", rangeMax: 89 },
  { label: "More than 3 months", days: 120, hint: "Deep clean recommended", rangeMax: 180 },
];

export function StepRecency({ days, onChange }: StepRecencyProps) {
  const selectedPreset = PRESETS.find((p) => days <= p.rangeMax) ?? PRESETS[3];

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
