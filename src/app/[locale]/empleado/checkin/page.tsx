"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Moon, Smile, Meh, Frown, Check, Zap, ShieldOff, Info } from "lucide-react";

type Mood = "happy" | "neutral" | "sad";

interface Checkin {
  checkin_date: string;
  slept_6h_plus: boolean | null;
  mood: Mood | null;
  shortcut_accepted: boolean;
}

const MOODS: { value: Mood; label: string; icon: typeof Smile }[] = [
  { value: "happy", label: "Bien", icon: Smile },
  { value: "neutral", label: "Regular", icon: Meh },
  { value: "sad", label: "Mal", icon: Frown },
];

/**
 * v8.3 E8.1 — Checklist matutino (opcional, incentivado). El backend
 * (daily_checkins + RLS bloqueada individualmente, migración 049) y la API
 * (/api/empleado/checkin) ya existían; esta pantalla era la única pieza que
 * faltaba para que un empleado realmente pudiera usarlo.
 */
export default function CheckinPage() {
  const [checkin, setCheckin] = useState<Checkin | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [slept6hPlus, setSlept6hPlus] = useState<boolean | null>(null);
  const [mood, setMood] = useState<Mood | null>(null);
  const [shortcutAccepted, setShortcutAccepted] = useState(false);
  const [privateMoodSuggestion, setPrivateMoodSuggestion] = useState<string | null>(null);
  const [streakBonusAwarded, setStreakBonusAwarded] = useState(false);
  const [wellbeingOptOut, setWellbeingOptOut] = useState(false);
  const [savingOptOut, setSavingOptOut] = useState(false);
  const [shortcutDescription, setShortcutDescription] = useState("");
  const [reportingShortcut, setReportingShortcut] = useState(false);
  const [shortcutReportMsg, setShortcutReportMsg] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/empleado/checkin", { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        if (d.checkin) {
          setCheckin(d.checkin);
          setSlept6hPlus(d.checkin.slept_6h_plus);
          setMood(d.checkin.mood);
          setShortcutAccepted(d.checkin.shortcut_accepted);
        }
        setPrivateMoodSuggestion(d.privateMoodSuggestion || null);
        setWellbeingOptOut(d.wellbeingOptOut === true);
      }
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/empleado/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ slept6hPlus, mood, shortcutAccepted }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "No se pudo guardar");
        return;
      }
      const d = await res.json();
      setCheckin(d.checkin);
      setStreakBonusAwarded(d.streakBonusAwarded === true);
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }

  async function toggleOptOut() {
    const next = !wellbeingOptOut;
    setSavingOptOut(true);
    try {
      const res = await fetch("/api/empleado/wellbeing-optout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ optOut: next }),
      });
      if (res.ok) {
        const d = await res.json();
        setWellbeingOptOut(d.wellbeingOptOut === true);
      }
    } finally {
      setSavingOptOut(false);
    }
  }

  async function reportShortcut() {
    if (!shortcutDescription.trim()) return;
    setReportingShortcut(true);
    setShortcutReportMsg("");
    try {
      const res = await fetch("/api/empleado/route-shortcuts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ description: shortcutDescription.trim() }),
      });
      if (res.ok) {
        setShortcutDescription("");
        setShortcutReportMsg("Atajo reportado. Tu supervisor lo revisará.");
      } else {
        const err = await res.json();
        setShortcutReportMsg(err.error || "No se pudo reportar");
      }
    } catch {
      setShortcutReportMsg("Error de red");
    } finally {
      setReportingShortcut(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  const alreadyDone = checkin !== null;

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">Checklist matutino</h1>
        <p className="text-sm text-gray-500 mt-1">
          Opcional. Nadie ve tu respuesta individual — ni siquiera el dueño. Solo se usa en agregado del equipo.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {alreadyDone && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex items-center gap-2">
          <Check className="w-4 h-4" /> Ya registraste tu checklist de hoy. Puedes actualizarlo si quieres.
        </div>
      )}

      {streakBonusAwarded && (
        <div className="bg-brand-gold/10 border border-brand-gold/40 rounded-lg p-3 text-sm text-brand-ink flex items-center gap-2">
          <Zap className="w-4 h-4 text-brand-gold" /> ¡Racha de 5 días! Se acreditaron $5 a tu próximo pago.
        </div>
      )}

      {privateMoodSuggestion && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{privateMoodSuggestion}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border p-5 space-y-5">
        <div>
          <p className="text-sm font-medium text-brand-ink mb-2 flex items-center gap-2">
            <Moon className="w-4 h-4 text-brand-wave-blue" /> ¿Dormiste 6 horas o más?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setSlept6hPlus(true)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${slept6hPlus === true ? "bg-brand-navy text-white border-brand-navy" : "border-gray-300 text-gray-600"}`}
            >
              Sí
            </button>
            <button
              onClick={() => setSlept6hPlus(false)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${slept6hPlus === false ? "bg-brand-navy text-white border-brand-navy" : "border-gray-300 text-gray-600"}`}
            >
              No
            </button>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-brand-ink mb-2">¿Cómo te sientes hoy?</p>
          <div className="flex gap-2">
            {MOODS.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.value}
                  onClick={() => setMood(m.value)}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-lg text-xs font-medium border ${mood === m.value ? "bg-brand-navy text-white border-brand-navy" : "border-gray-300 text-gray-600"}`}
                >
                  <Icon className="w-5 h-5" /> {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <label htmlFor="checkin-shortcut-accepted" className="flex items-center gap-2 text-sm text-gray-600">
          <input id="checkin-shortcut-accepted" type="checkbox" aria-label="Acepto el atajo de ruta sugerido hoy" checked={shortcutAccepted} onChange={(e) => setShortcutAccepted(e.target.checked)} />
          <span className="flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-brand-gold" /> Acepto el atajo de ruta sugerido hoy
          </span>
        </label>
        <p className="text-xs text-gray-400 -mt-3">
          Este atajo lo revisa tu supervisor manualmente. Si quieres reportar un atajo nuevo que descubriste y que se pague $10 al validarse, usa &quot;Reportar atajo de ruta&quot; abajo.
        </p>

        <button
          aria-label={saving ? "Guardando" : alreadyDone ? "Actualizar checklist de check-in" : "Enviar checklist de check-in"}
          onClick={submit}
          disabled={saving}
          className="w-full bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
        >
          {saving ? "Guardando..." : alreadyDone ? "Actualizar" : "Enviar checklist"}
        </button>
      </div>

      {/* v8.3 E8 FIX-4: "ruta con aprendizaje" -- reportar atajo real */}
      <div className="bg-white rounded-xl border p-5 space-y-3">
        <p className="text-sm font-medium text-brand-ink">Reportar atajo de ruta</p>
        <p className="text-xs text-gray-500">
          ¿Encontraste un atajo real que ahorra tiempo? Repórtalo. Si tu supervisor lo valida, se te pagan $10.
        </p>
        <textarea
          aria-label="Descripción del atajo de ruta"
          value={shortcutDescription}
          onChange={(e) => setShortcutDescription(e.target.value)}
          placeholder="Ej: tomar la calle X en vez de Y evita el semáforo, ahorra ~8 min"
          className="w-full border rounded-lg p-2 text-sm min-h-[70px] focus:ring-2 focus:ring-brand-navy focus:border-transparent"
        />
        {shortcutReportMsg && <p className="text-xs text-gray-600">{shortcutReportMsg}</p>}
        <button
          aria-label={reportingShortcut ? "Reportando" : "Reportar atajo de ruta"}
          onClick={reportShortcut}
          disabled={reportingShortcut || !shortcutDescription.trim()}
          className="w-full bg-brand-navy/10 text-brand-navy px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy/20 transition-colors disabled:opacity-50"
        >
          {reportingShortcut ? "Reportando..." : "Reportar atajo"}
        </button>
      </div>

      {/* v8.3 E8 FIX-2: opt-out de bienestar -- configuración del empleado */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <ShieldOff className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Excluirme de agregados de ánimo/sueño</p>
              <p className="text-xs text-gray-500 mt-1">
                Si activas esto, tus respuestas de ánimo y sueño dejan de contar incluso en los reportes agregados que ve el dueño. Puedes seguir usando el checklist para el atajo de ruta y la racha.
              </p>
            </div>
          </div>
          <button
            role="switch"
            aria-checked={wellbeingOptOut}
            aria-label="Excluirme de agregados de ánimo y sueño"
            onClick={toggleOptOut}
            disabled={savingOptOut}
            className={`shrink-0 w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 ${wellbeingOptOut ? "bg-brand-navy" : "bg-gray-300"}`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${wellbeingOptOut ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
