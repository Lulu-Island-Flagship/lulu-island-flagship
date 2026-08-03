"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mail, CheckCircle2, XCircle, Gift, MessageCircle } from "lucide-react";
import { StatusBanner } from "./StatusBanner";
import { supabase } from "@/lib/supabase";
import { AuthModal } from "@/components/cotizador/AuthModal";
import { getVancouverTodayString } from "@/lib/date-utils";

interface PreferencesState {
  marketingOptIn: boolean;
  updatedAt: string | null;
  autoUnsubscribedAt: string | null;
  birthDate: string | null;
  wechatNotifications: boolean;
}

export default function CommunicationPreferencesClient() {
  const t = useTranslations("cuenta.preferencias");
  const tCommon = useTranslations("cuenta.common");
  const [prefs, setPrefs] = useState<PreferencesState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  // Fix (auditoría externa 2026-07-24): mismo patrón ya aplicado en
  // MisServiciosClient.tsx -- este componente no comprobaba sesión antes de
  // pedir datos, así que una sesión expirada entre el chequeo del layout
  // padre (cuenta/layout.tsx) y este fetch se mostraba como un StatusBanner
  // de error genérico en vez de pedir login de nuevo.
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setNeedsAuth(true);
        setLoading(false);
        return;
      }
      setNeedsAuth(false);

      const res = await fetch("/api/client/communication-preferences", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) {
          setNeedsAuth(true);
          return;
        }
        const err = await res.json();
        setError(err.error || t("loadFailed"));
        return;
      }
      const data = await res.json();
      setPrefs({
        marketingOptIn: data.marketingOptIn,
        updatedAt: data.updatedAt,
        autoUnsubscribedAt: data.autoUnsubscribedAt,
        birthDate: data.birthDate,
        wechatNotifications: data.wechatNotifications ?? false,
      });
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function toggle(next: boolean) {
    setSaving(true);
    setError("");
    setSuccessMessage("");
    try {
      const res = await fetch("/api/client/communication-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ marketingOptIn: next }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("saveFailed"));
        return;
      }
      await load();
      setSuccessMessage(t("savedSuccess"));
    } catch {
      setError(t("networkError"));
    } finally {
      setSaving(false);
    }
  }

  const [birthDateInput, setBirthDateInput] = useState("");
  const [savingBirthDate, setSavingBirthDate] = useState(false);

  useEffect(() => {
    if (prefs?.birthDate) setBirthDateInput(prefs.birthDate);
  }, [prefs?.birthDate]);

  async function saveBirthDate() {
    setSavingBirthDate(true);
    setError("");
    setSuccessMessage("");
    try {
      const res = await fetch("/api/client/communication-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ birthDate: birthDateInput || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("saveFailed"));
        return;
      }
      await load();
      setSuccessMessage(t("birthdaySavedSuccess"));
    } catch {
      setError(t("networkError"));
    } finally {
      setSavingBirthDate(false);
    }
  }

  if (needsAuth) {
    return (
      <AuthModal
        onClose={() => {
          const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "en";
          const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
          window.location.href = `/${safeLocale}`;
        }}
        onSuccess={() => load()}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    // Fix (auditoría en vivo 2026-08-01, diseño): mismo problema que
    // billetera/referidos -- sin mx-auto ni px-4 quedaba pegado al borde
    // izquierdo. Se mantiene max-w-lg (es un formulario angosto, no una
    // lista como servicios/propiedades) pero se agrega mx-auto + px-4 py-8
    // para el mismo margen/centrado que el resto de /cuenta.
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("subtitle")}
        </p>
      </div>

      <StatusBanner
        variant="error"
        message={error}
        onRetry={load}
        onDismiss={() => setError("")}
        retryLabel={tCommon("retry")}
        dismissLabel={tCommon("dismiss")}
      />
      <StatusBanner
        variant="success"
        message={successMessage}
        onDismiss={() => setSuccessMessage("")}
        autoDismissMs={4000}
        dismissLabel={tCommon("dismiss")}
      />

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Mail className="w-5 h-5 text-brand-wave-blue shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-brand-ink text-sm">{t("marketingEmails")}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {t("marketingEmailsDesc")}
            </p>
          </div>
        </div>

        {prefs?.marketingOptIn ? (
          <div className="flex items-center gap-2 text-sm text-state-success">
            <CheckCircle2 className="w-4 h-4" /> {t("optedIn")}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <XCircle className="w-4 h-4" /> {t("optedOut")}
          </div>
        )}

        {prefs?.autoUnsubscribedAt && !prefs.marketingOptIn && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
            {t("autoUnsubscribedNotice")}
          </p>
        )}

        <button
          onClick={() => toggle(!prefs?.marketingOptIn)}
          disabled={saving}
          className="w-full bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
        >
          {saving ? t("saving") : prefs?.marketingOptIn ? t("optOut") : t("optIn")}
        </button>
      </div>

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <div className="flex items-start gap-3">
          <MessageCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-brand-ink text-sm">{t("wechatReminders")}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {t("wechatRemindersDesc")}
            </p>
          </div>
        </div>
        <button
          onClick={async () => {
            setSaving(true);
            setError("");
            try {
              const res = await fetch("/api/client/communication-preferences", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ wechatNotifications: !prefs?.wechatNotifications }),
              });
              if (!res.ok) throw new Error("Failed");
              await load();
            } catch {
              setError(t("networkError"));
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
          className="w-full bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
        >
          {saving ? t("saving") : prefs?.wechatNotifications ? t("wechatDisable") : t("wechatEnable")}
        </button>
      </div>

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Gift className="w-5 h-5 text-brand-gold-dark shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-brand-ink text-sm">{t("birthday")}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {t("birthdayDesc")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            aria-label={t("birthdayInputAriaLabel")}
            type="date"
            value={birthDateInput}
            onChange={(e) => setBirthDateInput(e.target.value)}
            // Fix (auditoría UX/seguridad 2026-07-25/26, P3): "Cumpleaños acepta
            // fechas futuras" -- max limita el date picker del navegador a hoy;
            // la validación real (formato + fecha calendario válida + no futura)
            // vive server-side en /api/client/communication-preferences.
            max={getVancouverTodayString()}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            aria-label={t("saveBirthdayAriaLabel")}
            onClick={saveBirthDate}
            disabled={savingBirthDate}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
          >
            {savingBirthDate ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
