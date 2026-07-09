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
    situation: "Cliente sin pago online",
    action: '"Pago pendiente" + e-transfer/efectivo con recibo.',
  },
  {
    situation: "PWA no carga",
    action: "Teléfono + papel + fotos con celular.",
  },
  {
    situation: "QBO sin sync >48h",
    action: "Llamar.",
  },
  {
    situation: "Sin acceso (llaves)",
    action: "Protocolo de llaves → no-show.",
  },
  {
    situation: "Stripe bloqueado",
    action: '"Pago pendiente" global.',
  },
  {
    situation: "Supabase caído",
    action: "Offline, no cancelar servicios.",
  },
  {
    situation: "Disputa",
    action: "Nunca reembolsar sin revisar evidencia.",
  },
  {
    situation: "Lesión",
    action: "WorkSafeBC 72h, no admitir culpa.",
  },
  {
    situation: "Acusación de daño",
    action: "Foto pre-servicio.",
  },
];

export default function ManualContingenciaPage() {
  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <ShieldAlert className="w-7 h-7 text-brand-navy" />
          <h1 className="text-xl font-bold text-brand-ink">Manual de Contingencia</h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">
          Una página. Si la situación no está aquí abajo: Fallback 10 min → Admin de Emergencia.
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
          <p className="text-sm font-semibold mb-1">Regla de oro</p>
          <p className="text-sm text-white/90">
            Si la situación no está en esta lista → Fallback de 10 minutos → escalar a
            Admin de Emergencia. Nunca improvisar una excepción nueva sin registrar el caso
            después para que se agregue aquí.
          </p>
        </div>
      </div>
    </main>
  );
}
