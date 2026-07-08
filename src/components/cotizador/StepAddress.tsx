"use client";

import React, { useEffect, useState } from "react";
import { MapPin, Home } from "lucide-react";
import { ACTIVE_ZONES } from "@/lib/pricing";
import { supabase } from "@/lib/supabase";
import type { ClientProperty } from "@/types";

interface StepAddressProps {
  address: string;
  zone: string;
  postalCode: string;
  onChange: (vals: { address: string; zone: string; postalCode: string }) => void;
}

export function StepAddress({ address, zone, postalCode, onChange }: StepAddressProps) {
  const [postalError, setPostalError] = React.useState("");
  const [savedProperties, setSavedProperties] = useState<ClientProperty[]>([]);

  // Regex para código postal canadiense: formato A1A 1A1 (con o sin espacio)
  const isValidCanadianPostal = (code: string): boolean => {
    const normalized = code.replace(/\s/g, "").toUpperCase();
    return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(normalized);
  };

  const handlePostalChange = (value: string) => {
    const upper = value.toUpperCase();
    onChange({ address, zone, postalCode: upper });
    if (upper.length >= 6) {
      setPostalError(isValidCanadianPostal(upper) ? "" : "Invalid format. Use: V6X 1A1");
    } else {
      setPostalError("");
    }
  };

  useEffect(() => {
    async function loadProperties() {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) {
          setSavedProperties([]);
          return;
        }
        const { data: profile } = await supabase
          .from("client_profiles")
          .select("id")
          .eq("user_id", authData.user.id)
          .single();
        if (!profile) return;
        const { data: properties } = await supabase
          .from("client_properties")
          .select("*")
          .eq("client_profile_id", profile.id)
          .eq("is_active", true)
          .order("created_at", { ascending: false });
        setSavedProperties((properties || []) as ClientProperty[]);
      } catch {
        setSavedProperties([]);
      }
    }
    loadProperties();
  }, []);

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-brand-ink mb-2">Where is your home?</h2>
        <p className="text-gray-600">We serve Richmond, Vancouver, North Vancouver, West Vancouver, and UBC.</p>
      </div>

      {savedProperties.length > 0 && (
        <div className="bg-brand-ice rounded-lg p-6">
          <label className="block font-semibold text-brand-ink mb-2 flex items-center gap-2">
            <Home className="w-5 h-5 text-brand-wave-blue" />
            Use a saved property
          </label>
          <select
            value=""
            onChange={(e) => {
              const property = savedProperties.find((p) => p.id === e.target.value);
              if (property) {
                onChange({
                  address: property.address,
                  zone: property.zone,
                  postalCode: property.postalCode || "",
                });
              }
            }}
            className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none transition-all bg-white"
          >
            <option value="">Select a saved address...</option>
            {savedProperties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.nickname ? `${property.nickname} — ` : ""}
                {property.address}
                {property.squareFeet ? ` (${property.squareFeet} ft²)` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

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
          {ACTIVE_ZONES.map((z) => {
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
          onChange={(e) => handlePostalChange(e.target.value)}
          placeholder="e.g. V7E 2A1"
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none transition-all uppercase"
        />
        {postalError && (
          <p className="text-sm text-state-danger mt-2">{postalError}</p>
        )}
      </div>
    </div>
  );
}
