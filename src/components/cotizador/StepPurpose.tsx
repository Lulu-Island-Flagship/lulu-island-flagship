"use client";

import React from "react";
import { ServiceType, SERVICE_TYPES } from "@/lib/pricing";
import { Sparkles, Home, Truck, HardHat } from "lucide-react";

const ICONS: Record<string, React.ReactNode> = {
  regular: <Sparkles className="w-8 h-8" />,
  deep: <Home className="w-8 h-8" />,
  move_in_out: <Truck className="w-8 h-8" />,
  post_construction: <HardHat className="w-8 h-8" />,
};

interface StepPurposeProps {
  value?: ServiceType;
  onChange: (value: ServiceType) => void;
}

export function StepPurpose({ value, onChange }: StepPurposeProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">
          What type of cleaning do you need?
        </h2>
        <p className="text-gray-600">
          Select the service that best matches your situation.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SERVICE_TYPES.map((type) => {
          const isSelected = value === type.key;
          return (
            <button
              key={type.key}
              onClick={() => onChange(type.key)}
              className={`p-6 rounded-lg border-2 text-left transition-all ${
                isSelected
                  ? "border-brand-gold bg-brand-gold/10"
                  : "border-gray-200 hover:border-brand-wave-blue hover:bg-brand-ice"
              }`}
            >
              <div
                className={`mb-4 ${
                  isSelected ? "text-brand-gold" : "text-brand-navy"
                }`}
              >
                {ICONS[type.key]}
              </div>
              <h3 className="font-semibold text-brand-ink mb-1">
                {type.label}
              </h3>
              <p className="text-sm text-gray-500">{type.labelEs}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
