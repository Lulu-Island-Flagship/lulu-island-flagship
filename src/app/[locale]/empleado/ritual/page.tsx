"use client";

// Fix (auditoría en vivo 2026-08-01): esta página completa estaba
// hardcodeada en español ("Ritual de turno", "Inicio de jornada", "¿Cómo
// llegas hoy?", etc.) aunque el resto del portal de empleado (dashboard,
// checkin, score, etc.) está hardcodeado en inglés -- confirmado en vivo
// visitando /en/empleado/ritual con una cuenta de prueba: toda la pantalla
// aparecía en español dentro de la ruta /en/.
//
// Fix (auditoría externa 2026-08-02, hallazgo MEDIO #5): el fix anterior
// solo tradujo el texto a inglés fijo -- seguía sin funcionar para /fr/ o
// /zh/. NextIntlClientProvider ya está montado en empleado/layout.tsx (el
// resto de páginas del portal de empleado, como el dashboard, ya lo
// consumen), así que ahora sí se usa next-intl (useTranslations) con las
// claves nuevas bajo "employee.ritual" en messages/{en,fr,zh}.json en vez
// de strings hardcodeados.
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Users, CloudSun, Trophy, DollarSign, Award, AlertTriangle, ShieldAlert } from "lucide-react";
import { EmpleadoBackHeader } from "@/components/empleado/EmpleadoBackHeader";
import { supabase } from "@/lib/supabase";
import { getVancouverTodayString, getVancouverOffset } from "@/lib/date-utils";

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
  const t = useTranslations("employee.ritual");
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const [inicio, setInicio] = useState<InicioData | null>(null);
  const [cierre, setCierre] = useState<CierreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Auditoría UX/seguridad 2026-07-25 (#14): "Fin de jornada" (ganancias del
  // día) se mostraba siempre, incluso al empezar el turno -- confuso para
  // un empleado que recién llega. Se gatea con el mismo evento
  // jornada_end/jornada_start que ya usa el dashboard (page.tsx,
  // checkJornadaStatus) para saber si el turno terminó hoy.
  const [jornadaEnded, setJornadaEnded] = useState(false);

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
        setReadinessError(data.error || t("couldNotSendRequest"));
        return;
      }
      setReadinessResult(data.decision?.reason || t("requestSent"));
      setShowReadinessForm(false);
    } catch {
      setReadinessError(t("networkError"));
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
        setChemicalAlertError(data.error || t("couldNotSaveStatus"));
        return;
      }
      setChemicalAlertResult(
        data.alertCreated ? t("chemicalAlertLogged") : t("statusSavedNoRisk")
      );
    } catch {
      setChemicalAlertError(t("networkError"));
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
        if (!inicioRes.ok && !cierreRes.ok) setError(t("loadError"));
      } catch {
        setError(t("networkError"));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    async function checkJornadaEnded() {
      try {
        // Mismo patrón que checkJornadaStatus() en empleado/page.tsx --
        // timestamp Vancouver con offset explícito para comparar contra TIMESTAMPTZ.
        // Auditoría externa (verificado real): esta pantalla todavía tenía el
        // parseo frágil de "PDT"/"PST" desde toLocaleString(), que puede
        // devolver "GMT-7" en vez de la abreviatura según navegador/runtime
        // (mismo bug ya corregido en empleado/page.tsx, ROUND 4 fix #2). Se
        // usa el offset numérico real vía Intl (getVancouverOffset), robusto
        // en cualquier entorno y correcto en las transiciones PST/PDT.
        const today = getVancouverTodayString();
        const offset = getVancouverOffset(today);
        const { data: logs } = await supabase
          .from("service_logs")
          .select("event_type")
          .eq("event_type", "jornada_end")
          .is("order_id", null)
          .gte("timestamp", `${today}T00:00:00${offset}`)
          .order("timestamp", { ascending: false })
          .limit(1);
        if (logs && logs.length > 0) setJornadaEnded(true);
      } catch (e) {
        console.error("Check jornada_end error:", e);
      }
    }
    checkJornadaEnded();
  }, []);

  const backHref = `/${locale}/empleado`;

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-ice">
        <EmpleadoBackHeader title={t("headerTitle")} backHref={backHref} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <EmpleadoBackHeader title={t("headerTitle")} backHref={backHref} />
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

      <div>
        <h1 className="text-lg font-bold text-brand-ink mb-3">{t("shiftStart")}</h1>
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Users className="w-4 h-4 text-brand-wave-blue shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">{t("yourTeamToday")}</p>
              <p className="text-xs text-gray-500">
                {inicio?.teammates.length ? inicio.teammates.map((mate) => mate.name).join(", ") : t("noTeammates")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CloudSun className="w-4 h-4 text-brand-gold shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">{t("weatherTraffic")}</p>
              <p className="text-xs text-gray-500">
                {inicio?.conditions.status === "ok"
                  ? inicio.conditions.delayMinutes
                    ? t("estimatedDelay", {
                        condition: inicio.conditions.condition ?? "",
                        minutes: inicio.conditions.delayMinutes,
                      })
                    : inicio.conditions.condition
                  : t("noWeatherProvider")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-brand-gold-dark shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-brand-ink">{t("top3Title")}</p>
              {inicio?.top3.length ? (
                <ol className="text-xs text-gray-500 list-decimal list-inside">
                  {inicio.top3.map((entry, i) => (
                    <li key={i}>{entry.teamName}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-gray-500">{t("noTop3Data")}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-brand-wave-blue shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-brand-ink">{t("arrivalQuestion")}</p>
            <p className="text-xs text-gray-500 mb-2">{t("wellbeingPrivacyNote")}</p>
            <div className="flex gap-2 mb-2">
              {(["happy", "neutral", "sad"] as Mood[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-label={t("moodAriaLabel", { mood: m })}
                  aria-pressed={mood === m}
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
                aria-label={t("sleptWellAria")}
                checked={sleptWell === true}
                onChange={(e) => setSleptWell(e.target.checked ? true : false)}
              />
              {t("sleptWell")}
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-2">
              <input
                type="checkbox"
                aria-label={t("chemicalRiskTaskAria")}
                checked={hasChemicalRiskTaskToday}
                onChange={(e) => setHasChemicalRiskTaskToday(e.target.checked)}
              />
              {t("chemicalRiskTask")}
            </label>
            {chemicalAlertError && <p className="text-xs text-red-600 mb-1">{chemicalAlertError}</p>}
            {chemicalAlertResult && <p className="text-xs text-state-success mb-1">{chemicalAlertResult}</p>}
            <button
              type="button"
              aria-label={t("loggingAria")}
              onClick={submitWellbeingCheckin}
              disabled={chemicalAlertSubmitting || mood === null}
              className="w-full bg-brand-navy text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {chemicalAlertSubmitting ? t("sending") : t("logStatus")}
            </button>
          </div>
        </div>

        <div className="border-t pt-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-state-danger shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-brand-ink">{t("notReadyQuestion")}</p>
              <p className="text-xs text-gray-500 mb-2">{t("notReadyDescription")}</p>
              {!showReadinessForm ? (
                <button
                  type="button"
                  onClick={() => setShowReadinessForm(true)}
                  className="text-xs text-brand-navy font-medium hover:underline"
                >
                  {t("reportNotReady")}
                </button>
              ) : (
                <form onSubmit={submitReadiness} className="space-y-2">
                  <select
                    aria-label={t("noticeTypeAria")}
                    value={readinessType}
                    onChange={(e) => setReadinessType(e.target.value as ReadinessRequestType)}
                    className="w-full border rounded-lg px-2 py-1.5 text-xs"
                  >
                    <option value="illness">{t("illness")}</option>
                    <option value="family_emergency">{t("familyEmergency")}</option>
                    <option value="no_transport">{t("noTransport")}</option>
                  </select>
                  <input
                    type="number"
                    aria-label={t("noticeHoursAria")}
                    placeholder={t("noticeHoursPlaceholder")}
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
                      aria-label={t("sendAria")}
                      disabled={readinessSubmitting}
                      className="flex-1 bg-state-danger text-white py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                    >
                      {readinessSubmitting ? t("sending") : t("send")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowReadinessForm(false)}
                      className="flex-1 border border-gray-300 py-1.5 rounded-lg text-xs"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* #14: solo se muestra una vez que la jornada realmente terminó hoy
          (jornada_end registrado) -- antes se mostraba siempre, confundiendo
          a un empleado que recién está empezando su turno. */}
      {jornadaEnded && (
        <div>
          <h1 className="text-lg font-bold text-brand-ink mb-3">{t("shiftEnd")}</h1>
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <div className="flex items-start gap-2">
              <DollarSign className="w-4 h-4 text-state-success shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-brand-ink">{t("todaysEarnings")}</p>
                <p className="text-xs text-gray-500">{cierre?.earnings.summaryText ?? "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Award className="w-4 h-4 text-brand-gold shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-brand-ink">{t("badges")}</p>
                <p className="text-xs text-gray-500">{t("badgesEarned", { count: cierre?.badgeCount ?? 0 })}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
