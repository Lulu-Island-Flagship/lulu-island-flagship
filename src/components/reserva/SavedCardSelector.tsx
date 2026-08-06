"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Loader2, CreditCard, Plus } from "lucide-react";

interface SavedCard {
  id: string;
  method_type: string;
  provider: string;
  last_four: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  is_default: boolean;
}

interface SavedCardSelectorProps {
  onSelectSavedCard: (methodId: string) => void;
  onUseNewCard: () => void;
  usingNewCard: boolean;
  disabled?: boolean;
}

export function SavedCardSelector({
  onSelectSavedCard,
  onUseNewCard,
  usingNewCard,
  disabled,
}: SavedCardSelectorProps) {
  const t = useTranslations("reserva.savedCardSelector");
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const hasManuallySelected = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/client/payment-methods", { credentials: "include" });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          const methods = data.methods || [];
          setCards(methods);
          // Auto-select default card if no card is selected yet
          if (methods.length > 0 && !selectedCardId) {
            const defaultCard = methods.find((c: SavedCard) => c.is_default);
            if (defaultCard) {
              setSelectedCardId(defaultCard.id);
              if (!hasManuallySelected.current) {
                onSelectSavedCard(defaultCard.id);
              }
            }
          }
        }
      } catch {
        if (!cancelled) setError(t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset selection when switching to new card
  const handleUseNewCard = useCallback(() => {
    setSelectedCardId(null);
    onUseNewCard();
  }, [onUseNewCard]);

  const handleSelectCard = useCallback((cardId: string) => {
    setSelectedCardId(cardId);
    hasManuallySelected.current = true;
    onSelectSavedCard(cardId);
  }, [onSelectSavedCard]);

  function formatExpiry(m: SavedCard): string {
    if (!m.expiry_month || !m.expiry_year) return "";
    return `${String(m.expiry_month).padStart(2, "0")}/${String(m.expiry_year).slice(-2)}`;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-brand-ink/50">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 py-2">{error}</p>;
  }

  const hasCards = cards.length > 0;

  return (
    <div className="space-y-2">
      {hasCards && (
        <>
          <p className="text-xs font-medium text-brand-ink/60 uppercase tracking-wider">
            {t("savedCards")}
          </p>
          <div className="space-y-1.5">
            {cards.map((card) => {
              const isSelected = selectedCardId === card.id;
              return (
                <label
                  key={card.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    disabled
                      ? "border-brand-ice bg-brand-ice/20 opacity-60"
                      : isSelected
                        ? "border-brand-navy bg-brand-navy/5"
                        : "border-brand-ice hover:border-brand-navy/40 bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="savedCard"
                    checked={isSelected}
                    disabled={disabled}
                    onChange={() => handleSelectCard(card.id)}
                    className="w-4 h-4 text-brand-navy"
                    aria-label={`${card.provider} terminada en ${card.last_four}`}
                  />
                  <CreditCard className={`w-5 h-5 shrink-0 ${isSelected ? "text-brand-navy" : "text-brand-navy/60"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-brand-ink">
                      •••• {card.last_four || "----"}
                      {card.is_default && (
                        <span className="ml-1.5 text-xs text-brand-navy/60 font-normal">
                          · {t("default")}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-brand-ink/50">
                      {formatExpiry(card) || ""}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}

      <label
        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
          disabled
            ? "border-brand-ice bg-brand-ice/20 opacity-60"
            : usingNewCard || !hasCards
              ? "border-brand-navy bg-brand-navy/5"
              : "border-brand-ice hover:border-brand-navy/40 bg-white"
        }`}
      >
        <input
          type="radio"
          name="savedCard"
          checked={usingNewCard || !hasCards}
          disabled={disabled}
          onChange={handleUseNewCard}
          className="w-4 h-4 text-brand-navy"
          aria-label={t("useNewCard")}
        />
        <Plus className={`w-5 h-5 shrink-0 ${usingNewCard ? "text-brand-navy" : "text-brand-navy/60"}`} />
        <span className="text-sm font-medium text-brand-ink">
          {t("useNewCard")}
        </span>
      </label>
    </div>
  );
}
