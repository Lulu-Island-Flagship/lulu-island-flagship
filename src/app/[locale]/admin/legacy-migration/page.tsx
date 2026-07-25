"use client";

import React, { useEffect, useState } from "react";
import { Loader2, CheckCircle2, Circle } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";

interface Item {
  item_key: string;
  label: string;
  completed_at: string | null;
  notes: string | null;
}

export default function LegacyMigrationPage() {
  const t = useTranslations("admin.legacyMigration");
  const locale = useLocale();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/legacy-migration", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function complete(itemKey: string) {
    setBusyKey(itemKey);
    try {
      const res = await fetch("/api/admin/legacy-migration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ itemKey }),
      });
      if (res.ok) await load();
    } finally {
      setBusyKey(null);
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

      <div className="bg-white rounded-xl border divide-y">
        {items.map((item) => (
          <div key={item.item_key} className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {item.completed_at ? (
                <CheckCircle2 className="w-5 h-5 text-state-success shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-gray-300 shrink-0" />
              )}
              <div>
                <p className="text-sm text-brand-ink">{item.label}</p>
                {item.completed_at && (
                  <p className="text-xs text-gray-400">
                    {t("done", { date: new Date(item.completed_at).toLocaleDateString(locale) })}
                  </p>
                )}
              </div>
            </div>
            {!item.completed_at && (
              <button
                onClick={() => complete(item.item_key)}
                disabled={busyKey === item.item_key}
                className="bg-brand-navy text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 shrink-0"
              >
                {busyKey === item.item_key ? "…" : t("markDone")}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
