"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

interface ChecklistItem {
  itemKey: string;
  frequency: "once" | "weekly" | "quarterly";
  lastCompletedAt: string | null;
  status: "never_done" | "ok" | "due_soon" | "overdue";
  label: string;
  notes: string | null;
}

const STATUS_STYLE: Record<ChecklistItem["status"], { className: string; icon: typeof CheckCircle2 }> = {
  never_done: { className: "text-gray-500 bg-gray-50", icon: Clock },
  ok: { className: "text-state-success bg-green-50", icon: CheckCircle2 },
  due_soon: { className: "text-amber-600 bg-amber-50", icon: Clock },
  overdue: { className: "text-state-danger bg-red-50", icon: AlertTriangle },
};

export default function SeoLocalPage() {
  const t = useTranslations("admin.seoLocal");
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [napOverdue, setNapOverdue] = useState(false);
  const [lastNapCheck, setLastNapCheck] = useState<{ checked_at: string; is_consistent: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [napSaving, setNapSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/seo-local", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setItems(data.items || []);
      setNapOverdue(!!data.napCheckOverdue);
      setLastNapCheck(data.lastNapCheck || null);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function completeItem(itemKey: string) {
    setBusyKey(itemKey);
    try {
      const res = await fetch("/api/admin/seo-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "complete_item", itemKey }),
      });
      if (res.ok) await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function recordNapCheck(isConsistent: boolean) {
    setNapSaving(true);
    try {
      const res = await fetch("/api/admin/seo-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "record_nap_check",
          directoriesChecked: ["Google Business Profile", "Yelp", "Bing Places"],
          isConsistent,
        }),
      });
      if (res.ok) await load();
    } finally {
      setNapSaving(false);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border divide-y">
        {items.map((item) => {
          const style = STATUS_STYLE[item.status];
          const Icon = style.icon;
          return (
            <div key={item.itemKey} className="p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-brand-ink text-sm">{item.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t(`frequencies.${item.frequency}`)} ·{" "}
                  {item.lastCompletedAt
                    ? t("lastDoneOn", { date: new Date(item.lastCompletedAt).toLocaleDateString() })
                    : t("statuses.never_done")}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${style.className}`}>
                  <Icon className="w-3.5 h-3.5" /> {t(`statuses.${item.status}`)}
                </span>
                <button
                  onClick={() => completeItem(item.itemKey)}
                  disabled={busyKey === item.itemKey}
                  className="bg-brand-navy text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {busyKey === item.itemKey ? "..." : t("markDone")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-brand-navy" />
          <h2 className="font-semibold text-brand-ink">{t("napHeading")}</h2>
        </div>
        <p className="text-sm text-gray-500">{t("napSubtitle")}</p>
        {lastNapCheck && (
          <p className="text-xs text-gray-400">
            {t("lastCheck", { date: new Date(lastNapCheck.checked_at).toLocaleDateString() })} —{" "}
            {lastNapCheck.is_consistent ? t("consistent") : t("inconsistenciesFound")}
          </p>
        )}
        {napOverdue && (
          <div className="bg-amber-50 text-amber-700 text-sm rounded-lg p-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {t("overdueNotice")}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => recordNapCheck(true)}
            disabled={napSaving}
            className="bg-state-success text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
          >
            {t("recordConsistent")}
          </button>
          <button
            onClick={() => recordNapCheck(false)}
            disabled={napSaving}
            className="bg-state-danger text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
          >
            {t("recordInconsistent")}
          </button>
        </div>
      </div>
    </div>
  );
}
