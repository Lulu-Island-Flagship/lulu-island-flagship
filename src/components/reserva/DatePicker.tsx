"use client";

import React from "react";
import { Calendar } from "lucide-react";

interface DatePickerProps {
  value: string; // ISO date string YYYY-MM-DD
  onChange: (date: string) => void;
  minDate?: string;
  maxDate?: string;
}

export function DatePicker({ value, onChange, minDate, maxDate }: DatePickerProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const defaultMin = minDate ?? tomorrow.toISOString().split("T")[0];
  const defaultMax =
    maxDate ??
    new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
      .toISOString()
      .split("T")[0];

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-brand-ink">
        Select Service Date
      </label>
      <div className="relative">
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          min={defaultMin}
          max={defaultMax}
          className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 focus:border-brand-gold focus:ring-1 focus:ring-brand-gold outline-none text-brand-ink"
        />
      </div>
      <p className="text-xs text-gray-500">
        We need at least 24 hours notice. Earliest available: {defaultMin}
      </p>
    </div>
  );
}
