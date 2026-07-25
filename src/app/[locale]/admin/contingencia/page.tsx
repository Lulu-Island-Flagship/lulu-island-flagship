"use client";

import React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * v8.3 E7 (D.7.10) — Manual de contingencia, una página.
 * Contenido tomado literal del spec — esta página no inventa política nueva,
 * solo la hace visible y accionable dentro del admin (además de la wiki).
 */

const ITEM_KEYS = [
  "noOnlinePayment",
  "pwaDown",
  "qboNotSynced",
  "noAccess",
  "stripeBlocked",
  "supabaseDown",
  "dispute",
  "injury",
  "damageAccusation",
] as const;

export default function ManualContingenciaPage() {
  const t = useTranslations("admin.contingencia");

  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <ShieldAlert className="w-7 h-7 text-brand-navy" />
          <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">{t("subtitle")}</p>

        <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
          {ITEM_KEYS.map((key) => (
            <div key={key} className="p-4 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-state-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-brand-ink">{t(`items.${key}.situation`)}</p>
                <p className="text-sm text-gray-600 mt-0.5">{t(`items.${key}.action`)}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 bg-brand-navy text-white rounded-xl p-4">
          <p className="text-sm font-semibold mb-1">{t("goldenRule.title")}</p>
          <p className="text-sm text-white/90">{t("goldenRule.text")}</p>
        </div>
      </div>
    </main>
  );
}
