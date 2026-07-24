"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mail, CheckCircle2, XCircle, Gift } from "lucide-react";
import { StatusBanner } from "./StatusBanner";

interface PreferencesState {
  marketingOptIn: boolean;
  updatedAt: string | null;
  autoUnsubscribedAt: string | null;
  birthDate: string | null;
}

export default function CommunicationPreferencesClient() {
  const t = useTranslations("cuenta.preferencias");
  const tCommon = useTranslations("cuenta.common");
  const [prefs, setPrefs] = useState<PreferencesState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/client/communication-preferences", { credentials: "include" });
      if (!res.ok) {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
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
