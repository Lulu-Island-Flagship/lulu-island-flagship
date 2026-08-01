"use client";

import React, { useState } from "react";
import { Plus, Check, DollarSign, Loader2 } from "lucide-react";
import { ErrorBanner } from "@/components/empleado/ErrorBanner";

interface UpsellOption {
  type: string;
  label: string;
  amount: number;
}

const UPSELL_OPTIONS: UpsellOption[] = [
  { type: "fridge", label: "Inside Fridge", amount: 45 },
  { type: "oven", label: "Inside Oven", amount: 35 },
  { type: "interior_windows", label: "Interior Windows", amount: 55 },
  { type: "carpets", label: "Carpet Cleaning", amount: 65 },
];

interface UpsellSelectorProps {
  orderId: string;
  onUpsellAdded?: () => void;
}

export function UpsellSelector({ orderId, onUpsellAdded }: UpsellSelectorProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  // Fix (auditoría 2026-07-31, #17): handleSubmit limpiaba la selección al
  // tener éxito pero no mostraba ninguna confirmación visual -- el empleado
  // no tenía forma de saber si el upsell realmente se guardó o si la UI
  // solo se reseteó. Mensaje breve, se autolimpia.
  const [successMessage, setSuccessMessage] = useState("");

  const toggleUpsell = (type: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setIsSubmitting(true);
    setError("");
    setSuccessMessage("");

    // Bug previo: este fetch nunca verificaba res.ok -- si el servidor
    // rechazaba el upsell (400/403/500), la UI igual limpiaba la selección
    // y mostraba éxito silencioso. Ahora cada upsell se verifica; los que
    // fallan se dejan seleccionados (para reintentar) y se avisa cuáles.
    const selectedArray = Array.from(selected);
    const failedTypes: string[] = [];
    const failedLabels: string[] = [];

    try {
      for (const type of selectedArray) {
        const option = UPSELL_OPTIONS.find((o) => o.type === type);
        if (!option) continue;

        try {
          const res = await fetch("/api/empleado/upsells", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              orderId,
              upsellType: option.type,
              upsellLabel: option.label,
              amount: option.amount,
              notes: notes || null,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error("Upsell submit error:", err.error || res.status);
            failedTypes.push(type);
            failedLabels.push(option.label);
          }
        } catch (e) {
          console.error("Upsell submit error:", e);
          failedTypes.push(type);
          failedLabels.push(option.label);
        }
      }

      if (failedTypes.length > 0) {
        setSelected(new Set(failedTypes));
        setError(
          `Couldn't record: ${failedLabels.join(", ")}. Please try again.`
        );
      } else {
        const savedCount = selectedArray.length;
        setSelected(new Set());
        setNotes("");
        setSuccessMessage(
          savedCount === 1 ? "Upsell recorded." : `${savedCount} upsells recorded.`
        );
        window.setTimeout(() => setSuccessMessage(""), 4000);
        onUpsellAdded?.();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalAmount = UPSELL_OPTIONS.filter((o) => selected.has(o.type)).reduce(
    (sum, o) => sum + o.amount,
    0
  );

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-500">
        Select additional services. These are recorded for the admin to review —
        they do not change the current price automatically.
      </div>

      <div className="space-y-2">
        {UPSELL_OPTIONS.map((option) => {
          const isSelected = selected.has(option.type);
          return (
            <button
              key={option.type}
              onClick={() => toggleUpsell(option.type)}
              className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                isSelected
                  ? "bg-brand-gold/10 border-brand-gold"
                  : "bg-white border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center ${
                    isSelected ? "bg-brand-navy text-white" : "bg-gray-100"
                  }`}
                >
                  {isSelected ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4 text-gray-400" />}
                </div>
                <span className="font-medium text-sm text-brand-ink">{option.label}</span>
              </div>
              <div className="flex items-center gap-1 text-sm font-semibold text-brand-ink">
                <DollarSign className="w-3.5 h-3.5" />
                {option.amount}
              </div>
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="bg-brand-ice rounded-lg p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Total upsell:</span>
            <span className="font-bold text-brand-ink">
              <DollarSign className="w-3.5 h-3.5 inline" />
              {totalAmount}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            For admin review only. Does not change the current charge.
          </p>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
        <input
          type="text"
          aria-label="Notas sobre el upsell"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Client agreed verbally / will confirm later..."
          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
        />
      </div>

      {successMessage && (
        <div
          role="status"
          className="flex items-center gap-2 bg-state-success/10 text-state-success text-sm rounded-lg px-3 py-2"
        >
          <Check className="w-4 h-4" /> {successMessage}
        </div>
      )}

      <ErrorBanner message={error} onRetry={handleSubmit} retrying={isSubmitting} />

      <button
        aria-label="Confirmar upsell seleccionado"
        onClick={handleSubmit}
        disabled={selected.size === 0 || isSubmitting}
        className="w-full bg-brand-navy text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <Plus className="w-4 h-4" />
            Record Upsell
          </>
        )}
      </button>
    </div>
  );
}
