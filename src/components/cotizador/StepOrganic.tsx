"use client";

import React from "react";
import { Cat, Dog, PawPrint, Users } from "lucide-react";

interface StepOrganicProps {
  petsCount: number;
  petsType: string;
  residents: number;
  onChange: (vals: { petsCount: number; petsType: string; residents: number }) => void;
}

const PET_TYPES = [
  { key: "none", label: "No pets", icon: <PawPrint className="w-5 h-5" /> },
  { key: "short_hair", label: "Short hair (cat/dog)", icon: <Cat className="w-5 h-5" /> },
  { key: "long_hair", label: "Long hair (cat/dog)", icon: <Dog className="w-5 h-5" /> },
  { key: "multiple", label: "Multiple / Other", icon: <PawPrint className="w-5 h-5" /> },
];

export function StepOrganic({ petsCount, petsType, residents, onChange }: StepOrganicProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">Who lives here?</h2>
        <p className="text-gray-600">This helps us estimate the cleaning effort needed.</p>
      </div>

      {/* Pets */}
      <div className="bg-brand-ice rounded-lg p-6 space-y-4">
        <h3 className="font-semibold text-brand-ink flex items-center gap-2">
          <PawPrint className="w-5 h-5 text-brand-wave-blue" />
          Pets
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {PET_TYPES.map((type) => {
            const isSelected = petsType === type.key;
            return (
              <button
                key={type.key}
                onClick={() =>
                  onChange({
                    petsCount: type.key === "none" ? 0 : Math.max(1, petsCount),
                    petsType: type.key,
                    residents,
                  })
                }
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? "border-brand-gold bg-brand-gold/10"
                    : "border-gray-200 hover:border-brand-wave-blue"
                }`}
              >
                <div className={`mb-2 ${isSelected ? "text-brand-gold" : "text-brand-navy"}`}>
                  {type.icon}
                </div>
                <span className="text-sm font-medium">{type.label}</span>
              </button>
            );
          })}
        </div>

        {petsType && petsType !== "none" && (
          <div className="flex items-center gap-4 pt-2">
            <span className="text-sm text-gray-600">How many?</span>
            <div className="flex items-center gap-2">
              {[1, 2, 3, "4+"].map((n) => (
                <button
                  key={n}
                  onClick={() =>
                    onChange({
                      petsCount: n === "4+" ? 4 : (n as number),
                      petsType,
                      residents,
                    })
                  }
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                    petsCount === (n === "4+" ? 4 : n)
                      ? "bg-brand-gold text-brand-navy"
                      : "bg-white border border-gray-200 text-gray-600 hover:border-brand-wave-blue"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Residents */}
      <div className="bg-brand-ice rounded-lg p-6">
        <h3 className="font-semibold text-brand-ink flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-brand-wave-blue" />
          Number of Residents
        </h3>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5, "6+"].map((n) => (
            <button
              key={n}
              onClick={() =>
                onChange({
                  petsCount,
                  petsType,
                  residents: n === "6+" ? 6 : (n as number),
                })
              }
              className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                residents === (n === "6+" ? 6 : n)
                  ? "bg-brand-gold text-brand-navy"
                  : "bg-white border border-gray-200 text-gray-600 hover:border-brand-wave-blue"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
