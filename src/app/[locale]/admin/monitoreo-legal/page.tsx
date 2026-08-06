"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Scale, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Feed {
  id: string;
  entity_name: string;
  check_frequency: string;
  last_checked_at: string | null;
  last_change_detected_at: string | null;
  isBlind: boolean;
}

interface Alert {
  id: string;
  feed_id: string;
  detected_at: string;
  change_description: string;
  dollar_impact_cents: number | null;
  suggested_actions: string[];
}

/**
 * v8.3 E9.7 — Monitoreo legal dinámico: 7 entes regulatorios, health-check
 * de "ceguera" (30 días sin chequear), y registro manual de cambios
 * detectados mientras no exista scraping real de cada sitio (fuera de
 * alcance, documentado en la propia ruta API). El backend ya existía; esta
 * página cierra el gap de que nadie podía usarlo.
 */
export default function LegalMonitoringPage() {
  const t = useTranslations("admin.monitoreoLegal");
  const params = useParams();
  // Item 13 (auditoría 2026-07-25): antes se formateaba en dólares crudos
  // ($X.XX) sin importar el locale. Intl.NumberFormat usa el locale real de
  // la ruta para separadores de miles/decimales; la moneda del negocio sigue
  // siendo CAD sin importar el idioma mostrado.
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
  const currencyFormatter = new Intl.NumberFormat(safeLocale === "zh" ? "zh-CA" : safeLocale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  });
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [changeForm, setChangeForm] = useState<{ feedId: string; description: string; impact: string } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/legal-monitoring", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("failedToLoad"));
        return;
      }
      setFeeds(data.feeds || []);
      setAlerts(data.openAlerts || []);
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function markChecked(feedId: string, withChange: boolean) {
    setCheckingId(feedId);
    setError("");
    try {
      const body: Record<string, unknown> = { feedId, changeDetected: withChange };
      if (withChange && changeForm) {
        body.changeDescription = changeForm.description;
        if (changeForm.impact.trim()) {
          // Item 11 (auditoría 2026-07-25): antes parseFloat() no validaba
          // el input -- un valor no numérico ("abc") producía NaN, que
          // Math.round(NaN * 100) también convierte en NaN, y el backend
          // recibía dollarImpactCents: NaN (serializado como `null` por
          // JSON.stringify, perdiendo el impacto en dólares silenciosamente).
          const parsed = Number(changeForm.impact);
          if (Number.isNaN(parsed) || parsed < 0) {
            setError(t("invalidImpact"));
            setCheckingId(null);
            return;
          }
          body.dollarImpactCents = Math.round(parsed * 100);
        }
      }
      const res = await fetch("/api/admin/legal-monitoring", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("failedToUpdate"));
        return;
      }
      setChangeForm(null);
      await load();
    } catch {
      setError(t("networkError"));
    } finally {
      setCheckingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  const blindCount = feeds.filter((f) => f.isBlind).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <Scale className="w-6 h-6" /> {t("title")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {blindCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {t("blindWarning", { count: blindCount })}
        </div>
      )}

      {alerts.length > 0 && (
        <div>
          <h2 className="font-semibold text-brand-ink mb-2">{t("openAlerts")}</h2>
          <div className="bg-white rounded-xl border divide-y">
            {alerts.map((a) => (
              <div key={a.id} className="p-3 text-sm">
                <p className="text-brand-ink">{a.change_description}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {t("detected", { date: new Date(a.detected_at).toLocaleDateString() })}
                  {a.dollar_impact_cents !== null &&
                    ` — ${t("impactLabel", { amount: currencyFormatter.format(a.dollar_impact_cents / 100) })}`}
                </p>
                {a.suggested_actions.length > 0 && (
                  <ul className="mt-1 list-disc list-inside text-xs text-gray-500">
                    {a.suggested_actions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">{t("feedsTitle")}</h2>
        <div className="bg-white rounded-xl border divide-y">
          {feeds.map((f) => (
            <div key={f.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-brand-ink text-sm flex items-center gap-2">
                    {f.entity_name}
                    {f.isBlind && <AlertTriangle className="w-3.5 h-3.5 text-state-danger" />}
                  </p>
                  <p className="text-xs text-gray-500">
                    {f.check_frequency} ·{" "}
                    {t("lastChecked", {
                      date: f.last_checked_at ? new Date(f.last_checked_at).toLocaleDateString() : t("never"),
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => markChecked(f.id, false)}
                    disabled={checkingId === f.id}
                    className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-navy text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t("noChange")}
                  </button>
                  <button
                    onClick={() =>
                      setChangeForm(
                        changeForm?.feedId === f.id ? null : { feedId: f.id, description: "", impact: "" }
                      )
                    }
                    className="text-xs font-medium text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg"
                  >
                    {t("logChange")}
                  </button>
                </div>
              </div>

              {changeForm?.feedId === f.id && (
                <div className="space-y-2 pt-2 border-t">
                  {/* Fix (auditoría 2026-07-30, item 6): estos inputs solo
                      tenían aria-label, sin label visual asociada. */}
                  <div>
                    <label htmlFor={`legal-change-desc-${f.id}`} className="text-xs text-gray-500 block mb-1">
                      {t("changeDescriptionLabel")}
                    </label>
                    <input
                      id={`legal-change-desc-${f.id}`}
                      type="text"
                      value={changeForm.description}
                      onChange={(e) => setChangeForm({ ...changeForm, description: e.target.value })}
                      placeholder={t("changeDescriptionPlaceholder")}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor={`legal-change-impact-${f.id}`} className="text-xs text-gray-500 block mb-1">
                      {t("dollarImpactLabel")}
                    </label>
                    <input
                      id={`legal-change-impact-${f.id}`}
                      type="number"
                      step="0.01"
                      value={changeForm.impact}
                      onChange={(e) => setChangeForm({ ...changeForm, impact: e.target.value })}
                      placeholder={t("dollarImpactLabel")}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    onClick={() => markChecked(f.id, true)}
                    disabled={checkingId === f.id || changeForm.description.trim().length === 0}
                    className="w-full bg-state-danger text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {t("logThisChange")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
