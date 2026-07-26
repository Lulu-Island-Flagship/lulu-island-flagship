"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";

interface QuoteButtonProps {
  variant?: "primary" | "secondary";
  children: React.ReactNode;
}

export function QuoteButton({ variant = "primary", children }: QuoteButtonProps) {
  const router = useRouter();
  // Fix (auditoría UX 2026-07-25): aria-label estaba hardcodeado en español
  // ("Comenzar cotización") sin importar el locale (en/fr/zh) del cliente.
  const t = useTranslations("landing");

  const handleClick = () => {
    try {
      // Track CTA click (lightweight, no third-party cookies)
      fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "cta_click",
          variant,
          timestamp: new Date().toISOString(),
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // ignore tracking errors
    }

    try {
      localStorage.removeItem("lulu_cotizador_state");
      localStorage.removeItem("lulu_pending_auth_quote");
    } catch {
      // ignore
    }
    // Preserve current locale when navigating to cotizador
    const pathLocale = window.location.pathname.match(/^\/(en|zh|fr)(\/|$)/);
    const locale = pathLocale ? pathLocale[1] : "en";
    router.push(`/${locale}/cotizador`);
  };

  const baseClasses =
    "inline-flex items-center justify-center gap-2 font-semibold px-8 py-4 rounded-lg transition-colors text-lg";
  // v8.3 rediseño "Powder Sky": el acento blush (brand-gold) es solo para
  // detalles pequeños (insignias, badges) por regla del token — nunca como
  // fondo grande de botón (contraste insuficiente para texto normal, ver
  // src/design/tokens.ts). El CTA principal usa el azul sólido de marca.
  const variantClasses =
    variant === "primary"
      ? "bg-brand-navy text-white hover:bg-brand-navy-light"
      : "bg-white text-brand-navy border-2 border-brand-navy hover:bg-brand-ice";

  return (
    <button aria-label={t("quoteButtonAriaLabel")} onClick={handleClick} className={`${baseClasses} ${variantClasses}`}>
      {children}
      <ChevronRight className="w-5 h-5" />
    </button>
  );
}
