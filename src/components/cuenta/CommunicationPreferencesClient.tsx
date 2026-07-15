"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Mail, CheckCircle2, XCircle, Gift } from "lucide-react";

interface PreferencesState {
  marketingOptIn: boolean;
  updatedAt: string | null;
  autoUnsubscribedAt: string | null;
  birthDate: string | null;
}

export default function CommunicationPreferencesClient() {
  const [prefs, setPrefs] = useState<PreferencesState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
        setError(err.error || "Failed to load");
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
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function toggle(next: boolean) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/client/communication-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ marketingOptIn: next }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to save");
        return;
      }
      await load();
    } catch {
      setError("Network error");
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
    try {
      const res = await fetch("/api/client/communication-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ birthDate: birthDateInput || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to save");
        return;
      }
      await load();
    } catch {
      setError("Network error");
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
        <h1 className="text-2xl font-bold text-brand-ink">Communication Preferences</h1>
        <p className="text-sm text-gray-500 mt-1">
          Service messages (confirmations, arrival updates, payment receipts) always reach you regardless of this
          setting — those are transactional, not marketing.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Mail className="w-5 h-5 text-brand-wave-blue shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-brand-ink text-sm">Marketing emails</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Seasonal offers, maintenance reminders, and referral programs. You can opt in or out at any time.
            </p>
          </div>
        </div>

        {prefs?.marketingOptIn ? (
          <div className="flex items-center gap-2 text-sm text-state-success">
            <CheckCircle2 className="w-4 h-4" /> Currently opted in
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <XCircle className="w-4 h-4" /> Currently opted out
          </div>
        )}

        {prefs?.autoUnsubscribedAt && !prefs.marketingOptIn && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
            You were automatically opted out after several unopened emails. Opt back in anytime below.
          </p>
        )}

        <button
          onClick={() => toggle(!prefs?.marketingOptIn)}
          disabled={saving}
          className="w-full bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : prefs?.marketingOptIn ? "Opt out of marketing emails" : "Opt in to marketing emails"}
        </button>
      </div>

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Gift className="w-5 h-5 text-brand-gold-dark shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-brand-ink text-sm">Birthday (optional)</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Tell us your birthday and we&apos;ll add a Lulu Wallet gift every year. Completely optional -- never
              used for anything else.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={birthDateInput}
            onChange={(e) => setBirthDateInput(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={saveBirthDate}
            disabled={savingBirthDate}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
          >
            {savingBirthDate ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
