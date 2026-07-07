"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

interface QuoteButtonProps {
  variant?: "primary" | "secondary";
  children: React.ReactNode;
}

export function QuoteButton({ variant = "primary", children }: QuoteButtonProps) {
  const router = useRouter();

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
  const variantClasses =
    variant === "primary"
      ? "bg-brand-gold text-brand-navy hover:bg-brand-gold-dark"
      : "bg-brand-navy text-white hover:bg-brand-navy-light";

  return (
    <button onClick={handleClick} className={`${baseClasses} ${variantClasses}`}>
      {children}
      <ChevronRight className="w-5 h-5" />
    </button>
  );
}
