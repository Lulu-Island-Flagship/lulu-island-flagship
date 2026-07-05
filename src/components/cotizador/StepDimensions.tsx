"use client";

import React from "react";
import { Minus, Plus, Ruler } from "lucide-react";

interface StepDimensionsProps {
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  onChange: (vals: { bedrooms: number; bathrooms: number; squareFeet: number }) => void;
}

export function StepDimensions({ bedrooms, bathrooms, squareFeet, onChange }: StepDimensionsProps) {
  const adjust = (key: "bedrooms" | "bathrooms", delta: number) => {
    const current = key === "bedrooms" ? bedrooms : bathrooms;
    const next = Math.max(0, current + delta);
    onChange({ bedrooms, bathrooms, squareFeet, [key]: next });
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">Tell us about your space</h2>
        <p className="text-gray-600">This helps us estimate the time and team needed.</p>
      </div>

      {/* Bedrooms */}
      <div className="bg-brand-ice rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-brand-ink">Bedrooms</h3>
            <p className="text-sm text-gray-500">Including master and guest rooms</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => adjust("bedrooms", -1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-semibold text-lg">{bedrooms}</span>
            <button
              onClick={() => adjust("bedrooms", 1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bathrooms */}
      <div className="bg-brand-ice rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-brand-ink">Bathrooms</h3>
            <p className="text-sm text-gray-500">Full and half bathrooms</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => adjust("bathrooms", -1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-semibold text-lg">{bathrooms}</span>
            <button
              onClick={() => adjust("bathrooms", 1)}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:border-brand-wave-blue transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Square Feet */}
      <div className="bg-brand-ice rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Ruler className="w-5 h-5 text-brand-wave-blue" />
          <div>
            <h3 className="font-semibold text-brand-ink">Approximate Square Footage</h3>
            <p className="text-sm text-gray-500">Best estimate is fine</p>
          </div>
        </div>
        <input
          type="range"
          min="300"
          max="5000"
          step="100"
          value={squareFeet}
          onChange={(e) => onChange({ bedrooms, bathrooms, squareFeet: parseInt(e.target.value) })}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-gold"
        />
        <div className="flex justify-between mt-2 text-sm text-gray-500">
          <span>300 ft²</span>
          <span className="font-semibold text-brand-ink text-lg">{squareFeet.toLocaleString()} ft²</span>
          <span>5,000+ ft²</span>
        </div>
      </div>
    </div>
  );
}
