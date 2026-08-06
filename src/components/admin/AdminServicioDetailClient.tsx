"use client";

import React, { useCallback,  useState, useEffect } from "react";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Loader2,
  ChevronLeft,
  Clock,
  AlertCircle,
  ClipboardCheck,
  Check,
} from "lucide-react";

interface ChecklistItem {
  itemId: string;
  label: string;
  required: boolean;
  isCompleted: boolean;
  completedAt?: string | null;
  photoUrl?: string;
  notes?: string;
  employeeId?: string;
}

interface ChecklistZone {
  checklistId: string;
  zone: string;
  zoneLabel: string;
  zoneColor: string;
  zoneIcon: string;
  totalItems: number;
  completedItems: number;
  requiredItems: number;
  requiredCompleted: number;
  items: ChecklistItem[];
}

interface ChecklistProgress {
  totalItems: number;
  completedItems: number;
  requiredItems: number;
  requiredCompleted: number;
  percentComplete: number;
  percentRequired: number;
}

export default function AdminServicioDetailClient() {
  const t = useTranslations("admin.servicioDetail");
  const router = useRouter();
  const params = useParams();
  const orderId = params?.orderId as string;

  // Item 8 (auditoría 2026-07-25): antes se leía el locale con
  // window.location.pathname.split("/")[1], que rendería "en" fijo en el
  // servidor (SSR) vs el locale real en el cliente -- riesgo de hydration
  // mismatch. useParams() lee el segmento [locale] de la ruta directo del
  // router, igual que ya hace AdminDashboardClient.tsx.
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
  const adminPath = `/${safeLocale}/admin`;

  const [zones, setZones] = useState<ChecklistZone[]>([]);
  const [progress, setProgress] = useState<ChecklistProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!orderId) return;
    loadChecklist();
  }, [loadChecklist, orderId]);

  const loadChecklist = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/checklist?orderId=${orderId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setZones(data.zones || []);
      setProgress(data.progress || null);
      // Expand all by default
      setExpandedZones(new Set((data.zones || []).map((z: ChecklistZone) => z.zone)));
    } catch {
      setError(t("errors.networkError"));
    } finally {
      setLoading(false);
    }
  }, [orderId, t]);

  const toggleZone = (zone: string) => {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zone)) {
        next.delete(zone);
      } else {
        next.add(zone);
      }
      return next;
    });
  };

  const getColorClass = (color: string) => {
    switch (color) {
      case "red":
        return "bg-red-100 text-red-700 border-red-200";
      case "blue":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "green":
        return "bg-green-100 text-green-700 border-green-200";
      case "yellow":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "white":
        return "bg-gray-100 text-gray-700 border-gray-200";
      case "black":
        return "bg-gray-800 text-white border-gray-600";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700 font-medium">{error}</p>
        <button
          onClick={() => router.push(`${adminPath}/servicios`)}
          className="mt-4 inline-flex items-center gap-2 text-brand-navy font-medium"
        >
          <ChevronLeft className="w-4 h-4" />
          {t("backToServices")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push(`${adminPath}/servicios`)}
          aria-label={t("backToServices")}
          className="text-gray-500 hover:text-brand-navy"
        >
          <ChevronLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
      </div>

      {/* Progress summary */}
      {progress && (
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-brand-gold" />
              <span className="font-medium text-brand-ink">{t("progress.title")}</span>
            </div>
            <span className="text-lg font-bold text-brand-ink">
              {progress.percentComplete}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-brand-gold h-3 rounded-full transition-all"
              style={{ width: `${progress.percentComplete}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>
              {t("progress.itemsCount", { completed: progress.completedItems, total: progress.totalItems })}
            </span>
            <span>
              {t("progress.requiredCount", { completed: progress.requiredCompleted, total: progress.requiredItems })}
            </span>
          </div>
        </div>
      )}

      {/* Zones */}
      <div className="space-y-3">
        {zones.map((zone) => {
          const isExpanded = expandedZones.has(zone.zone);
          return (
            <div key={zone.zone} className="bg-white rounded-xl border overflow-hidden">
              <button
                onClick={() => toggleZone(zone.zone)}
                className={`w-full flex items-center justify-between p-4 ${getColorClass(zone.zoneColor)}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{zone.zoneIcon}</span>
                  <span className="font-semibold">{zone.zoneLabel}</span>
                  <span className="text-xs opacity-70">
                    ({zone.completedItems}/{zone.totalItems})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {zone.completedItems === zone.totalItems && (
                    <Check className="w-4 h-4" />
                  )}
                  <span className="text-sm">
                    {isExpanded ? "−" : "+"}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="p-4 space-y-3">
                  {zone.items.map((item) => (
                    <div
                      key={item.itemId}
                      className={`flex items-start gap-3 p-3 rounded-lg ${
                        item.isCompleted ? "bg-green-50" : "bg-gray-50"
                      }`}
                    >
                      <div
                        className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                          item.isCompleted
                            ? "bg-state-success border-state-success text-white"
                            : "border-gray-300 bg-white"
                        }`}
                      >
                        {item.isCompleted && <Check className="w-3.5 h-3.5" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm ${
                              item.isCompleted
                                ? "line-through text-gray-500"
                                : "text-brand-ink"
                            }`}
                          >
                            {item.label}
                          </span>
                          {item.required && (
                            <span className="text-xs text-red-500 font-medium">*</span>
                          )}
                        </div>

                        {item.completedAt && (
                          <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                            <Clock className="w-3 h-3" />
                            {new Date(item.completedAt).toLocaleString(locale)}
                          </div>
                        )}

                        {item.photoUrl && (
                          <Image
                            src={item.photoUrl}
                            alt={t("evidenceAltText")}
                            width={96}
                            height={96}
                            className="mt-2 rounded-lg w-24 h-24 object-cover"
                          />
                        )}

                        {item.notes && (
                          <p className="text-xs text-gray-500 mt-1">{item.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {zones.length === 0 && (
        <div className="bg-white rounded-xl border p-8 text-center">
          <ClipboardCheck className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("noChecklistTemplate")}</p>
        </div>
      )}
    </div>
  );
}
