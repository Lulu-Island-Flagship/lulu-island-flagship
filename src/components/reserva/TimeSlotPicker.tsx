"use client";

import React from "react";
import { Clock } from "lucide-react";

interface TimeSlotPickerProps {
  value: string; // HH:MM
  onChange: (time: string) => void;
  serviceDate?: string; // YYYY-MM-DD, needed for weekend surcharge check
}

const START_HOUR = 8; // 8:00 AM
const END_HOUR = 18; // 6:00 PM

function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = START_HOUR; h < END_HOUR; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

function isWeekend(dateStr: string): boolean {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

export function TimeSlotPicker({ value, onChange, serviceDate }: TimeSlotPickerProps) {
  const slots = generateTimeSlots();
  const weekend = serviceDate ? isWeekend(serviceDate) : false;

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-brand-ink">
        Select Time
      </label>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {slots.map((slot) => {
          const isSelected = value === slot;
          return (
            <button
              key={slot}
              onClick={() => onChange(slot)}
              className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isSelected
                  ? "bg-brand-navy text-white"
                  : "bg-gray-50 text-brand-ink hover:bg-gray-100 border border-gray-200"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              {slot}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        Service window: 8:00 AM – 6:00 PM
        {weekend && (
          <span className="block text-brand-gold mt-1">
            Weekend surcharge applies (Sat/Sun).
          </span>
        )}
      </p>
    </div>
  );
}
