"use client";

import React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";

/**
 * v8.3 E7 (D.7.10) — Manual de contingencia, una página.
 * Contenido tomado literal del spec — esta página no inventa política nueva,
 * solo la hace visible y accionable dentro del admin (además de la wiki).
 */

interface ContingencyItem {
  situation: string;
  action: string;
}

const ITEMS: ContingencyItem[] = [
  {
    situation: "Client with no online payment",
    action: '"Payment pending" + e-transfer/cash with receipt.',
  },
  {
    situation: "PWA won't load",
    action: "Phone + paper + photos with cellphone.",
  },
  {
    situation: "QBO not synced >48h",
    action: "Call.",
  },
  {
    situation: "No access (keys)",
    action: "Key protocol → no-show.",
  },
  {
    situation: "Stripe blocked",
    action: '"Payment pending" globally.',
  },
  {
    situation: "Supabase down",
    action: "Offline, do not cancel services.",
  },
  {
    situation: "Dispute",
    action: "Never refund without reviewing evidence.",
  },
  {
    situation: "Injury",
    action: "WorkSafeBC 72h, do not admit fault.",
  },
  {
    situation: "Damage accusation",
    action: "Pre-service photo.",
  },
];

export default function ManualContingenciaPage() {
  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <ShieldAlert className="w-7 h-7 text-brand-navy" />
          <h1 className="text-xl font-bold text-brand-ink">Contingency Manual</h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">
          One page. If the situation isn't listed below: 10 min Fallback → Emergency Admin.
        </p>

        <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
          {ITEMS.map((item) => (
            <div key={item.situation} className="p-4 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-state-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-brand-ink">{item.situation}</p>
                <p className="text-sm text-gray-600 mt-0.5">{item.action}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 bg-brand-navy text-white rounded-xl p-4">
          <p className="text-sm font-semibold mb-1">Golden rule</p>
          <p className="text-sm text-white/90">
            If the situation isn't on this list → 10-minute Fallback → escalate to
            Emergency Admin. Never improvise a new exception without logging the case
            afterward so it can be added here.
          </p>
        </div>
      </div>
    </main>
  );
}
