"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Users, CloudSun, Trophy, DollarSign, Award, AlertTriangle, ShieldAlert } from "lucide-react";

type ReadinessRequestType = "illness" | "family_emergency" | "no_transport";
type Mood = "happy" | "neutral" | "sad";

interface InicioData {
  employeeName: string;
  teammates: { name: string }[];
  conditions: { status: string; condition: string | null; delayMinutes: number | null };
  top3: { teamName: string }[];
}

interface CierreData {
  employeeName: string;
  earnings: { summaryText: string };
  badgeCount: number;
}

export default function ShiftRitualPage() {
  const [inicio, setInicio] = useState<InicioData | null>(null);
  const [cierre, setCierre] = useState<CierreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // v8.3 E8 — checklist previo al turno: "No estoy listo" (readiness) y
  // auto-reporte de ánimo/sueño que dispara la alerta de riesgo químico si
  // corresponde. Ambos endpoints (/api/empleado/readiness,
  // /api/empleado/chemical-alert) ya existían testeados con sus funciones
  // puras en lib/wellbeing.ts, pero ninguna pantalla los invocaba todavía.
  const [showReadinessForm, setShowReadinessForm] = useState(false);
  const [readinessType, setReadinessType] = useState<ReadinessRequestType>("illness");
  const [noticeHours, setNoticeHours] = useState("2");
  const [readinessSubmitting, setReadinessSubmitting] = useState(false);
  const [readinessResult, setReadinessResult] = useState("");
  const [readinessError, setReadinessError] = useState("");

  const [mood, setMood] = useState<Mood | null>(null);
  const [sleptWell, setSleptWell] = useState<boolean | null>(null);
  const [hasChemicalRiskTaskToday, setHasChemicalRiskTaskToday] = useState(false);
  const [chemicalAlertSubmitting, setChemicalAlertSubmitting] = useState(false);
  const [chemicalAlertResult, setChemicalAlertResult] = useState("");
  const [chemicalAlertError, setChemicalAlertError] = useState("");

  async function submitReadiness(e: React.FormEvent) {
    e.preventDefault();
    setReadinessSubmitting(true);
    setReadinessError("");
    setReadinessResult("");
    try {
      const res = await fetch("/api/empleado/readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ requestType: readinessType, noticeHours: Number(noticeHours) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReadinessError(data.error || "No se pudo enviar la solicitud");
        return;
      }
      setReadinessResult(data.decision?.reason || "Solicitud enviada.");
      setShowReadinessForm(false);
    } catch {
      setReadinessError("Error de red");
    } finally {
      setReadinessSubmitting(false);
    }
  }

  async function submitWellbeingCheckin() {
    setChemicalAlertSubmitting(true);
    setChemicalAlertError("");
    setChemicalAlertResult("");
    try {
      const res = await fetch("/api/empleado/chemical-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mood, slept6hPlus: sleptWell, hasChemicalRiskTaskToday }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChemicalAlertError(data.error || "No se pudo registrar el estado");
        return;
      }
      setChemicalAlertResult(
        data.alertCreated
          ? "Alerta registrada: un supervisor será notificado para reasignar tareas de riesgo si no responde en 10 min."
          : "Estado registrado. Sin riesgo detectado hoy."
      );
    } catch {
      setChemicalAlertError("Error de red");
    } finally {
      setChemicalAlertSubmitting(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [inicioRes, cierreRes] = await Promise.all([
          fetch("/api/empleado/ritual/inicio", { credentials: "include" }),
          fetch("/api/empleado/ritual/cierre", { credentials: "include" }),
        ]);
        if (inicioRes.ok) setInicio(await inicioRes.json());
        if (cierreRes.ok) setCierre(await cierreRes.json());
        if (!inicioRes.ok && !cierreRes.ok) setError("No se pudo cargar");
      } catch {
        setError("Error de red");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-md mx-auto">
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

      <div>
        <h1 className="text-lg font-bold text-brand-ink mb-3">Inicio de jornada</h1>
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Users className="w-4 h-4 text-brand-wave-blue shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Tu equipo hoy</p>
              <p className="text-xs text-gray-500">
                {inicio?.teammates.length ? inicio.teammates.map((t) => t.name).join(", ") : "Sin compañeros asignados hoy."}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CloudSun className="w-4 h-4 text-brand-gold shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Clima y tráfico</p>
              <p className="text-xs text-gray-500">
                {inicio?.conditions.status === "ok"
                  ? `${inicio.conditions.condition}${inicio.conditions.delayMinutes ? ` — retraso estimado ${inicio.conditions.delayMinutes} min` : ""}`
                  : "Sin proveedor de clima/tráfico configurado todavía."}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-brand-gold-dark shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Top 3 de la semana</p>
              {inicio?.top3.length ? (
                <ol className="text-xs text-gray-500 list-decimal list-inside">
                  {inicio.top3.map((t, i) => (
                    <li key={i}>{t.teamName}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-gray-500">Sin datos aún esta semana.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-brand-wave-blue shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-brand-ink">¿Cómo llegas hoy?</p>
            <p className="text-xs text-gray-500 mb-2">Solo se usa para bienestar del equipo, nunca se identifica individualmente.</p>
            <div className="flex gap-2 mb-2">
              {(["happy", "neutral", "sad"] as Mood[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-label={`Ánimo: ${m}`}
                  onClick={() => setMood(m)}
                  className={`flex-1 py-2 rounded-lg text-lg border-2 transition-colors ${mood === m ? "border-brand-navy bg-brand-navy/5" : "border-gray-200"}`}
                >
                  {m === "happy" ? "🙂" : m === "neutral" ? "😐" : "🙁"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-1">
              <input
                type="checkbox"
                aria-label="Dormí 6 o más horas"
                checked={sleptWell === true}
                onChange={(e) => setSleptWell(e.target.checked ? true : false)}
              />
              Dormí 6+ horas
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-2">
              <input
                type="checkbox"
                aria-label="Hoy tengo una tarea con productos químicos"
                checked={hasChemicalRiskTaskToday}
                onChange={(e) => setHasChemicalRiskTaskToday(e.target.checked)}
              />
              Hoy tengo una tarea con productos químicos
            </label>
            {chemicalAlertError && <p className="text-xs text-red-600 mb-1">{chemicalAlertError}</p>}
            {chemicalAlertResult && <p className="text-xs text-state-success mb-1">{chemicalAlertResult}</p>}
            <button
              type="button"
              aria-label="Registrar mi estado de ánimo y bienestar"
              onClick={submitWellbeingCheckin}
              disabled={chemicalAlertSubmitting || mood === null}
              className="w-full bg-brand-navy text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {chemicalAlertSubmitting ? "Enviando..." : "Registrar mi estado"}
            </button>
          </div>
        </div>

        <div className="border-t pt-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-state-danger shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-brand-ink">¿No estás listo para el turno?</p>
              <p className="text-xs text-gray-500 mb-2">Enfermedad, emergencia familiar o falta de transporte.</p>
              {!showReadinessForm ? (
                <button
                  type="button"
                  onClick={() => setShowReadinessForm(true)}
                  className="text-xs text-brand-navy font-medium hover:underline"
                >
                  Reportar que no estoy listo
                </button>
              ) : (
                <form onSubmit={submitReadiness} className="space-y-2">
                  <select
                    aria-label="Tipo de aviso"
                    value={readinessType}
                    onChange={(e) => setReadinessType(e.target.value as ReadinessRequestType)}
                    className="w-full border rounded-lg px-2 py-1.5 text-xs"
                  >
                    <option value="illness">Enfermedad</option>
                    <option value="family_emergency">Emergencia familiar</option>
                    <option value="no_transport">Sin transporte</option>
                  </select>
                  <input
                    type="number"
                    aria-label="Horas de anticipación del aviso"
                    placeholder="Horas de anticipación"
                    value={noticeHours}
                    onChange={(e) => setNoticeHours(e.target.value)}
                    className="w-full border rounded-lg px-2 py-1.5 text-xs"
                    min={0}
                    required
                  />
                  {readinessError && <p className="text-xs text-red-600">{readinessError}</p>}
                  {readinessResult && <p className="text-xs text-state-success">{readinessResult}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      aria-label="Enviar aviso de no estar listo para el turno"
                      disabled={readinessSubmitting}
                      className="flex-1 bg-state-danger text-white py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                    >
                      {readinessSubmitting ? "Enviando..." : "Enviar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowReadinessForm(false)}
                      className="flex-1 border border-gray-300 py-1.5 rounded-lg text-xs"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h1 className="text-lg font-bold text-brand-ink mb-3">Fin de jornada</h1>
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex items-start gap-2">
            <DollarSign className="w-4 h-4 text-state-success shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Ganancias de hoy</p>
              <p className="text-xs text-gray-500">{cierre?.earnings.summaryText ?? "—"}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Award className="w-4 h-4 text-brand-gold shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">Insignias</p>
              <p className="text-xs text-gray-500">{cierre?.badgeCount ?? 0} insignia(s) obtenidas</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
