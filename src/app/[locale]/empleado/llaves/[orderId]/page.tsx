"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Key, Loader2, ChevronLeft, AlertTriangle, Check } from "lucide-react";

type KeyMethod = "in_person" | "lockbox" | "third_party" | "problem";

interface KeyLog {
  id: string;
  method: KeyMethod;
  lockbox_code?: string;
  confirmed_returned?: boolean;
  escalated_at?: string;
  escalation_resolved_as?: string;
  created_at: string;
}

const METHODS: { value: KeyMethod; label: string }[] = [
  { value: "in_person", label: "En persona" },
  { value: "lockbox", label: "Lockbox" },
  { value: "third_party", label: "Tercero" },
  { value: "problem", label: "Problema de acceso" },
];

export default function LlavesPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params?.orderId as string;

  const locale = (typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [logs, setLogs] = useState<KeyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [method, setMethod] = useState<KeyMethod>("in_person");
  const [lockboxCode, setLockboxCode] = useState("");
  const [confirmedReturned, setConfirmedReturned] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (orderId) load();
  }, [orderId]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/empleado/llaves?orderId=${orderId}`, { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setLogs(d.logs || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/empleado/llaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId,
          method,
          lockboxCode: method === "lockbox" ? lockboxCode : undefined,
          confirmedReturned: method === "in_person" ? confirmedReturned : undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Error al registrar.");
        return;
      }
      setLockboxCode("");
      setConfirmedReturned(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const pendingProblem = logs.find((l) => l.method === "problem" && l.escalation_resolved_as === "pending");

  return (
    <main className="min-h-screen bg-brand-ice">
      <header className="bg-brand-navy text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.push(`/${safeLocale}/empleado/servicio/${orderId}`)} className="text-white/70 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-semibold text-sm flex items-center gap-2">
            <Key className="w-4 h-4" /> Manejo de Llaves
          </h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {pendingProblem && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Hay un problema de acceso reportado y pendiente de resolver. Si pasan 15 min sin respuesta del admin, se documenta como no-show.</span>
          </div>
        )}

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
        ) : (
          <>
            <form onSubmit={submit} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3">
              <h2 className="text-sm font-semibold text-brand-ink">Registrar acceso</h2>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => (
                  <button
                    type="button"
                    key={m.value}
                    onClick={() => setMethod(m.value)}
                    className={`text-sm px-3 py-2 rounded-lg font-medium ${
                      method === m.value ? "bg-brand-navy text-white" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {method === "lockbox" && (
                <input
                  type="text"
                  aria-label="Código del lockbox"
                  placeholder="Código del lockbox"
                  value={lockboxCode}
                  onChange={(e) => setLockboxCode(e.target.value)}
                  className="w-full text-sm border rounded-lg px-3 py-2"
                />
              )}

              {method === "in_person" && (
                <label htmlFor="keys-confirm-returned" className="flex items-center gap-2 text-sm">
                  <input
                    id="keys-confirm-returned"
                    type="checkbox"
                    aria-label="Confirmo que devolví las llaves al cliente"
                    checked={confirmedReturned}
                    onChange={(e) => setConfirmedReturned(e.target.checked)}
                  />
                  Confirmo que devolví las llaves al cliente
                </label>
              )}

              {method === "problem" && (
                <p className="text-xs text-gray-500">
                  Esto notifica al admin de inmediato. Si no hay respuesta en 15 min, se escala automáticamente.
                </p>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> Registrar
              </button>
            </form>

            <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
              {logs.length === 0 && <p className="p-4 text-sm text-gray-500">Sin registros todavía.</p>}
              {logs.map((l) => (
                <div key={l.id} className="p-3 text-sm">
                  <span className="font-medium capitalize">{l.method.replace("_", " ")}</span>
                  <span className="text-gray-400 ml-2">{new Date(l.created_at).toLocaleTimeString("en-CA")}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
