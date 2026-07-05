"use client";

import React from "react";
import { MapPin } from "lucide-react";
import { ZONES } from "@/lib/pricing";

interface StepAddressProps {
  address: string;
  zone: string;
  postalCode: string;
  onChange: (vals: { address: string; zone: string; postalCode: string }) => void;
}

export function StepAddress({ address, zone, postalCode, onChange }: StepAddressProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">Where is your home?</h2>
        <p className="text-gray-600">We serve Richmond and Metro Vancouver.</p>
      </div>

      {/* Address */}
      <div className="bg-brand-ice rounded-lg p-6">
        <label className="block font-semibold text-brand-ink mb-2 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-brand-wave-blue" />
          Street Address
        </label>
        <input
          type="text"
          value={address}
          onChange={(e) => onChange({ address: e.target.value, zone, postalCode })}
          placeholder="e.g. 123 Main Street, Richmond"
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none transition-all"
        />
      </div>

      {/* Zone */}
      <div className="bg-brand-ice rounded-lg p-6">
        <label className="block font-semibold text-brand-ink mb-3">Area / Zone</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ZONES.map((z) => {
            const isSelected = zone === z.name;
            return (
              <button
                key={z.name}
                onClick={() => onChange({ address, zone: z.name, postalCode })}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? "border-brand-gold bg-brand-gold/10"
                    : "border-gray-200 hover:border-brand-wave-blue"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{z.name}</span>
                  {z.surcharge > 0 && (
                    <span className="text-sm text-state-warning font-medium">
                      +${z.surcharge}
                    </span>
                  )}
                  {z.surcharge === 0 && (
                    <span className="text-sm text-state-success font-medium">Base</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Postal Code */}
      <div className="bg-brand-ice rounded-lg p-6">
        <label className="block font-semibold text-brand-ink mb-2">Postal Code</label>
        <input
          type="text"
          value={postalCode}
          onChange={(e) =>
            onChange({ address, zone, postalCode: e.target.value.toUpperCase() })
          }
          placeholder="e.g. V7E 2A1"
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none transition-all uppercase"
        />
      </div>
    </div>
  );
}
