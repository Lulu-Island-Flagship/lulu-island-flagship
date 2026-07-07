"use client";

import React, { useState, useEffect } from "react";
import {
  Check,
  Camera,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ChecklistZoneProgress } from "@/types";

interface ChecklistCierreProps {
  orderId: string;
  serviceSubtype: string;
}

export function ChecklistCierre({ orderId, serviceSubtype }: ChecklistCierreProps) {
  const [zones, setZones] = useState<ChecklistZoneProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  const [overallProgress, setOverallProgress] = useState({
    totalItems: 0,
    completedItems: 0,
    requiredItems: 0,
    requiredCompleted: 0,
    percentComplete: 0,
    percentRequired: 0,
  });

  useEffect(() => {
    loadChecklist();
  }, [orderId, serviceSubtype]);

  async function loadChecklist() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/empleado/checklist?orderId=${orderId}&serviceSubtype=${serviceSubtype}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        console.error("Checklist load error:", await res.json());
        setLoading(false);
        return;
      }
      const data = await res.json();
      setZones(data.zones || []);
      setOverallProgress(data.progress || {
        totalItems: 0,
        completedItems: 0,
        requiredItems: 0,
        requiredCompleted: 0,
        percentComplete: 0,
        percentRequired: 0,
      });
      // Expand all zones by default
      setExpandedZones(new Set((data.zones || []).map((z: ChecklistZoneProgress) => z.zone)));
    } catch (e) {
      console.error("Checklist load error:", e);
    } finally {
      setLoading(false);
    }
  }

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

  const handleToggleItem = async (zone: ChecklistZoneProgress, itemId: string, itemLabel: string) => {
    const item = zone.items.find((i) => i.itemId === itemId);
    if (!item) return;

    const newCompleted = !item.isCompleted;

    // Optimistic update
    setZones((prev) =>
      prev.map((z) => {
        if (z.zone !== zone.zone) return z;
        const newItems = z.items.map((i) =>
          i.itemId === itemId ? { ...i, isCompleted: newCompleted } : i
        );
        const completedItems = newItems.filter((i) => i.isCompleted).length;
        const requiredCompleted = newItems.filter((i) => i.required && i.isCompleted).length;
        return {
          ...z,
          completedItems,
          requiredCompleted,
          items: newItems,
        };
      })
    );

    // Recalculate overall progress
    setZones((prev) => {
      const totalItems = prev.reduce((sum, z) => sum + z.totalItems, 0);
      const completedItems = prev.reduce((sum, z) => sum + z.completedItems, 0);
      const requiredItems = prev.reduce((sum, z) => sum + z.requiredItems, 0);
      const requiredCompleted = prev.reduce((sum, z) => sum + z.requiredCompleted, 0);
      setOverallProgress({
        totalItems,
        completedItems,
        requiredItems,
        requiredCompleted,
        percentComplete: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
        percentRequired: requiredItems > 0 ? Math.round((requiredCompleted / requiredItems) * 100) : 100,
      });
      return prev;
    });

    // Save to server
    try {
      const res = await fetch("/api/empleado/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId,
          checklistId: zone.checklistId, // UUID real de sop_checklists
          itemId,
          itemLabel,
          isCompleted: newCompleted,
        }),
      });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
    } catch (e) {
      console.error("Checklist save error:", e);
      // Rollback: revert to original state
      setZones((prev) =>
        prev.map((z) => {
          if (z.zone !== zone.zone) return z;
          const newItems = z.items.map((i) =>
            i.itemId === itemId ? { ...i, isCompleted: !newCompleted } : i
          );
          const completedItems = newItems.filter((i) => i.isCompleted).length;
          const requiredCompleted = newItems.filter((i) => i.required && i.isCompleted).length;
          return {
            ...z,
            completedItems,
            requiredCompleted,
            items: newItems,
          };
        })
      );
      // Recalculate overall progress after rollback
      setZones((prev) => {
        const totalItems = prev.reduce((sum, z) => sum + z.totalItems, 0);
        const completedItems = prev.reduce((sum, z) => sum + z.completedItems, 0);
        const requiredItems = prev.reduce((sum, z) => sum + z.requiredItems, 0);
        const requiredCompleted = prev.reduce((sum, z) => sum + z.requiredCompleted, 0);
        setOverallProgress({
          totalItems,
          completedItems,
          requiredItems,
          requiredCompleted,
          percentComplete: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
          percentRequired: requiredItems > 0 ? Math.round((requiredCompleted / requiredItems) * 100) : 100,
        });
        return prev;
      });
    }
  };

  const handleItemPhoto = async (zone: ChecklistZoneProgress, itemId: string, file: File) => {
    setUploadingItem(itemId);
    try {
      const fileExt = file.name.split(".").pop() || "jpg";
      const fileName = `${orderId}/checklist/${zone.zone}/${itemId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("service-photos")
        .upload(fileName, file, { contentType: file.type });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("service-photos")
        .getPublicUrl(fileName);

      const photoUrl = publicUrlData.publicUrl;

      // Update local state
      setZones((prev) =>
        prev.map((z) => {
          if (z.zone !== zone.zone) return z;
          return {
            ...z,
            items: z.items.map((i) =>
              i.itemId === itemId ? { ...i, photoUrl } : i
            ),
          };
        })
      );

      // Save to server
      const item = zone.items.find((i) => i.itemId === itemId);
      if (item) {
        await fetch("/api/empleado/checklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            orderId,
            checklistId: zone.checklistId, // UUID real de sop_checklists
            itemId,
            itemLabel: item.label,
            isCompleted: item.isCompleted,
            photoUrl,
          }),
        });
      }
    } catch (e) {
      console.error("Item photo error:", e);
    } finally {
      setUploadingItem(null);
    }
  };

  const getColorClass = (color: string) => {
    switch (color) {
      case "red": return "bg-red-100 text-red-700 border-red-200";
      case "blue": return "bg-blue-100 text-blue-700 border-blue-200";
      case "green": return "bg-green-100 text-green-700 border-green-200";
      case "yellow": return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "white": return "bg-gray-100 text-gray-700 border-gray-200";
      case "black": return "bg-gray-800 text-white border-gray-600";
      default: return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (zones.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No checklist available for this service type.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-brand-ink">Overall Progress</span>
          <span className="text-sm font-bold text-brand-ink">{overallProgress.percentComplete}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-brand-gold h-2 rounded-full transition-all duration-300"
            style={{ width: `${overallProgress.percentComplete}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
          <span>{overallProgress.completedItems} of {overallProgress.totalItems} items</span>
          <span>{overallProgress.requiredCompleted} of {overallProgress.requiredItems} required</span>
        </div>
      </div>

      {/* Zones */}
      <div className="space-y-2">
        {zones.map((zone) => {
          const isExpanded = expandedZones.has(zone.zone);
          const zoneColorClass = getColorClass(zone.zoneColor);

          return (
            <div key={zone.zone} className="bg-white rounded-lg border overflow-hidden">
              {/* Zone header */}
              <button
                onClick={() => toggleZone(zone.zone)}
                className={`w-full flex items-center justify-between p-3 ${zoneColorClass}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{zone.zoneIcon}</span>
                  <span className="font-semibold text-sm">{zone.zoneLabel}</span>
                  <span className="text-xs opacity-70">
                    ({zone.completedItems}/{zone.totalItems})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {zone.completedItems === zone.totalItems && (
                    <Check className="w-4 h-4" />
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </div>
              </button>

              {/* Zone items */}
              {isExpanded && (
                <div className="p-3 space-y-2">
                  {zone.items.map((item) => (
                    <div
                      key={item.itemId}
                      className={`flex items-start gap-3 p-2 rounded-lg transition-colors ${
                        item.isCompleted ? "bg-green-50" : "bg-gray-50"
                      }`}
                    >
                      <button
                        onClick={() => handleToggleItem(zone, item.itemId, item.label)}
                        className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                          item.isCompleted
                            ? "bg-state-success border-state-success text-white"
                            : "border-gray-300 bg-white"
                        }`}
                      >
                        {item.isCompleted && <Check className="w-3.5 h-3.5" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className={`text-sm ${item.isCompleted ? "line-through text-gray-500" : "text-brand-ink"}`}>
                            {item.label}
                          </span>
                          {item.required && (
                            <span className="text-xs text-red-500 font-medium">*</span>
                          )}
                        </div>

                        {/* Photo for item */}
                        <div className="mt-2">
                          {item.photoUrl ? (
                            <img
                              src={item.photoUrl}
                              alt="Evidence"
                              className="w-16 h-16 rounded-lg object-cover"
                            />
                          ) : (
                            <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer hover:text-brand-gold">
                              <Camera className="w-3.5 h-3.5" />
                              <span>Add photo</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleItemPhoto(zone, item.itemId, file);
                                }}
                                disabled={uploadingItem === item.itemId}
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
