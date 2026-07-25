"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2, ChevronLeft, Check } from "lucide-react";
import { ErrorBanner } from "@/components/empleado/ErrorBanner";

type Color = "red" | "blue" | "green" | "yellow" | "white" | "black";
type Stage = "clean" | "in_use" | "dirty" | "washing" | "warehouse" | "vehicle";

interface TowelLog {
  id: string;
  color: Color;
  stage: Stage;
  count: number;
  recorded_at: string;
}

const COLORS: { value: Color; label: string; swatch: string }[] = [
  { value: "red", label: "Rojo", swatch: "bg-red-500" },
  { value: "blue", label: "Azul", swatch: "bg-blue-500" },
  { value: "green", label: "Verde", swatch: "bg-green-500" },
  { value: "yellow", label: "Amarillo", swatch: "bg-yellow-400" },
  { value: "white", label: "Blanco", swatch: "bg-gray-200 border" },
  { value: "black", label: "Negro", swatch: "bg-gray-900" },
];

const STAGES: { value: Stage; label: string }[] = [
  { value: "clean", label: "Limpio" },
  { value: "in_use", label: "En uso" },
  { value: "dirty", label: "Sucio" },
  { value: "washing", label: "Lavado" },
  { value: "warehouse", label: "Bodega" },
  { value: "vehicle", label: "Vehículo" },
];

export default function PanosPage() {
  const router = useRouter();
  const params = useParams();
  // 2026-07-24: antes leía window.location.pathname, lo que causaba un
  // hydration mismatch (SSR asumía "en", cliente calculaba el locale real) --
  // ver auditoría externa. useParams() da el mismo valor en servidor y
  // cliente porque viene del router de Next, no de window.
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [logs, setLogs] = useState<TowelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [color, setColor] = useState<Color>("red");
  const [stage, setStage] = useState<Stage>("clean");
  const [count, setCount] = useState("");
  // Auditoría UX/seguridad 2026-07-25 (#6): antes un fallo de red al cargar
  // o enviar el conteo de paños fallaba en silencio (solo `finally`, sin
  // mensaje) -- el empleado no tenía forma de saber si su conteo realmente
  // se guardó o no.
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/empleado/panos", { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setLogs(d.logs || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setLoadError(err.error || "Couldn't load today's towel logs. Please try again.");
      }
    } catch (e) {
      console.error("Panos load error:", e);
      setLoadError("Connection error loading today's towel logs. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const n = parseInt(count);
    if (isNaN(n) || n < 0) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/empleado/panos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ color, stage, count: n }),
      });
      if (res.ok) {
        setCount("");
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        setSubmitError(err.error || "Couldn't save the count. Please try again.");
      }
    } catch (e) {
      console.error("Panos submit error:", e);
      setSubmitError("Connection error saving the count. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <header className="bg-brand-navy text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.push(`/${safeLocale}/empleado`)} className="text-white/70 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-semibold text-sm">Ciclo de Paños</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <p className="text-xs text-gray-500">Conteo por color, no por unidad (ej: &quot;8 rojos, 6 azules&quot;).</p>

        <form onSubmit={submit} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c.value}
                onClick={() => setColor(c.value)}
                className={`flex items-center gap-2 text-sm px-2 py-2 rounded-lg font-medium ${
                  color === c.value ? "ring-2 ring-brand-navy bg-gray-50" : "bg-gray-100 text-gray-600"
                }`}
              >
                <span className={`w-3 h-3 rounded-full ${c.swatch}`} />
                {c.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Etapa del ciclo de paños"
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage)}
            className="w-full text-sm border rounded-lg px-3 py-2"
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          <input
            type="number"
            aria-label="Cantidad de paños"
            placeholder="Cantidad"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-full text-sm border rounded-lg px-3 py-2"
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> Registrar conteo
          </button>
          <ErrorBanner message={submitError} onRetry={() => submit()} retrying={submitting} />
        </form>

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
        ) : loadError ? (
          <ErrorBanner message={loadError} onRetry={load} retrying={loading} />
        ) : (
          <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
            {logs.length === 0 && <p className="p-4 text-sm text-gray-500">Sin registros hoy.</p>}
            {logs.map((l) => (
              <div key={l.id} className="p-3 text-sm flex justify-between">
                <span className="capitalize">{l.color} · {l.stage}</span>
                <span className="font-medium">{l.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
