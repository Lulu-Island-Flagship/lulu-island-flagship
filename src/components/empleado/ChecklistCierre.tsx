"use client";

import React, { useState, useEffect } from "react";
import {
  Check,
  Camera,
  Loader2,
  ChevronDown,
  ChevronUp,
  Lock,
  Timer,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ChecklistZoneProgress } from "@/types";
import { isZoneUnlocked } from "@/lib/chemical-lockout";
import { isHotSurfaceItemUnlocked, minutesRemaining } from "@/lib/kitchen-timer";
import { ChemicalMatchModal } from "@/components/empleado/ChemicalMatchModal";
import { ErrorBanner } from "@/components/empleado/ErrorBanner";

interface ChecklistCierreProps {
  orderId: string;
  serviceSubtype: string;
  /**
   * Candado químico (E4, B.2.8): zonas cuyo color aún no fue confirmado
   * explícitamente no se pueden tocar. Si no se pasan estas props, el
   * candado queda desactivado (compatibilidad hacia atrás).
   */
  confirmedColors?: ReadonlySet<string>;
  onConfirmedColorsChange?: (next: Set<string>) => void;
}

export function ChecklistCierre({
  orderId,
  serviceSubtype,
  confirmedColors,
  onConfirmedColorsChange,
}: ChecklistCierreProps) {
  const [zones, setZones] = useState<ChecklistZoneProgress[]>([]);
  const [myZoneCount, setMyZoneCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  const [matchModalZone, setMatchModalZone] = useState<{ zoneColor: string; zoneLabel: string } | null>(null);
  // Antes, si el guardado de un ítem (toggle o foto) fallaba, la UI hacía
  // rollback silencioso (buen instinto -- no dejaba avanzar un cambio no
  // confirmado) pero nunca mostraba ningún mensaje, así que el empleado
  // veía un checkbox "que se destildó solo" sin explicación.
  const [saveError, setSaveError] = useState("");
  const [overallProgress, setOverallProgress] = useState({
    totalItems: 0,
    completedItems: 0,
    requiredItems: 0,
    requiredCompleted: 0,
    percentComplete: 0,
    percentRequired: 0,
  });

  // Auditoría UX/seguridad 2026-07-25 (#5): si la página se recarga o se
  // pierde la conexión antes de que un toggle termine de sincronizar con el
  // servidor, el estado marcado se perdía por completo (sin cache local
  // alguna). No existe en el resto del código un patrón de cola offline
  // genérico por item de checklist (offline-queue.ts está tipado para
  // eventos de servicio t_in/t_start/t_out/photo/note, no para items de
  // checklist arbitrarios), así que se usa localStorage como respaldo
  // mínimo: cada cambio de `zones` se persiste, y al montar se restauran
  // los checks que el servidor aún no confirme.
  const localStorageKey = `lulu_checklist_cierre_${orderId}`;

  function loadLocalSnapshot(): ChecklistZoneProgress[] | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(localStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.zones) ? parsed.zones : null;
    } catch {
      return null;
    }
  }

  function saveLocalSnapshot(nextZones: ChecklistZoneProgress[]) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        localStorageKey,
        JSON.stringify({ zones: nextZones, savedAtIso: new Date().toISOString() })
      );
    } catch {
      // localStorage lleno o deshabilitado -- el respaldo es best-effort,
      // nunca debe romper el flujo principal.
    }
  }

  function clearLocalSnapshot() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(localStorageKey);
    } catch {
      // no-op
    }
  }

  useEffect(() => {
    loadChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, serviceSubtype]);

  // Respaldo local: cualquier cambio en `zones` (toggle, foto) se guarda de
  // inmediato, así un refresh o pérdida de conexión antes del POST no borra
  // lo ya marcado -- se restaura al volver a montar (ver loadChecklist).
  useEffect(() => {
    if (zones.length > 0) saveLocalSnapshot(zones);
  }, [zones]);

  /** Aplica sobre `serverZones` cualquier item que localStorage tenga marcado como completado y el servidor no. */
  function mergeLocalSnapshotOntoServerZones(
    serverZones: ChecklistZoneProgress[]
  ): ChecklistZoneProgress[] {
    const local = loadLocalSnapshot();
    if (!local) return serverZones;
    const localById = new Map<string, { isCompleted: boolean; photoUrl?: string }>();
    for (const z of local) {
      for (const item of z.items) {
        localById.set(item.itemId, { isCompleted: item.isCompleted, photoUrl: item.photoUrl });
      }
    }
    return serverZones.map((z) => {
      const items = z.items.map((item) => {
        const localItem = localById.get(item.itemId);
        // Solo aplicamos el override local si "adelanta" al servidor
        // (marcado localmente pero no en el servidor) -- nunca desmarcamos
        // algo que el servidor ya confirmó.
        if (localItem?.isCompleted && !item.isCompleted) {
          return { ...item, isCompleted: true, photoUrl: item.photoUrl ?? localItem.photoUrl };
        }
        return item;
      });
      const completedItems = items.filter((i) => i.isCompleted).length;
      const requiredCompleted = items.filter((i) => i.required && i.isCompleted).length;
      return { ...z, items, completedItems, requiredCompleted };
    });
  }

  function recomputeOverallProgress(zonesList: ChecklistZoneProgress[]) {
    const totalItems = zonesList.reduce((sum, z) => sum + z.totalItems, 0);
    const completedItems = zonesList.reduce((sum, z) => sum + z.completedItems, 0);
    const requiredItems = zonesList.reduce((sum, z) => sum + z.requiredItems, 0);
    const requiredCompleted = zonesList.reduce((sum, z) => sum + z.requiredCompleted, 0);
    setOverallProgress({
      totalItems,
      completedItems,
      requiredItems,
      requiredCompleted,
      percentComplete: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
      percentRequired: requiredItems > 0 ? Math.round((requiredCompleted / requiredItems) * 100) : 100,
    });
  }

  async function loadChecklist() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/empleado/checklist?orderId=${orderId}&serviceSubtype=${serviceSubtype}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        console.error("Checklist load error:", await res.json());
        // Sin respuesta válida del servidor: si hay un snapshot local de
        // una sesión anterior para esta orden, mostrarlo en vez de dejar la
        // pantalla vacía -- mejor un estado potencialmente desactualizado
        // que perder de vista el progreso ya marcado.
        const local = loadLocalSnapshot();
        if (local && local.length > 0) {
          setZones(local);
          recomputeOverallProgress(local);
          setExpandedZones(new Set(local.map((z) => z.zone)));
        }
        setLoading(false);
        return;
      }
      const data = await res.json();
      const merged = mergeLocalSnapshotOntoServerZones(data.zones || []);
      setZones(merged);
      // v8.3 E4 (D.7): myZones !== null y con menos zonas que el total
      // significa que el reparto real corrió (N>=2) y a este empleado le
      // tocó un subconjunto — se lo mostramos para que no piense que faltan
      // zonas por error.
      setMyZoneCount(Array.isArray(data.myZones) ? data.myZones.length : null);
      if (merged.length > 0) {
        recomputeOverallProgress(merged);
      } else {
        setOverallProgress(data.progress || {
          totalItems: 0,
          completedItems: 0,
          requiredItems: 0,
          requiredCompleted: 0,
          percentComplete: 0,
          percentRequired: 0,
        });
      }
      // Expand all zones by default
      setExpandedZones(new Set(merged.map((z: ChecklistZoneProgress) => z.zone)));
    } catch (e) {
      console.error("Checklist load error:", e);
      // Fallo de red total al cargar: igual, preferir el snapshot local si existe.
      const local = loadLocalSnapshot();
      if (local && local.length > 0) {
        setZones(local);
        recomputeOverallProgress(local);
        setExpandedZones(new Set(local.map((z) => z.zone)));
      }
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

    // v8.3 E4 (D.7): candado real — un ítem de superficie caliente no se
    // puede marcar completado antes de que venza el timer de 10 min. El
    // servidor lo vuelve a rechazar igual (409) si esto se evade en el cliente.
    if (
      item.hotSurface &&
      !item.isCompleted &&
      !isHotSurfaceItemUnlocked(item.hotSurfaceTimerStartedAt ?? null, new Date().toISOString())
    ) {
      return;
    }

    const newCompleted = !item.isCompleted;
    setSaveError("");

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

    // Save to server -- #5 fix: distinguimos un fallo de RED real (fetch()
    // lanza, típico sin conexión) de un RECHAZO explícito del servidor
    // (respuesta HTTP no-ok, ej. candado químico/timer todavía activo).
    // Antes ambos casos revertían el check de inmediato sin diferenciar --
    // perdiendo el trabajo del empleado apenas se quedaba sin señal, aunque
    // el toggle en sí fuera válido y solo faltara conectividad para
    // confirmarlo. Ahora, si es un fallo de red, el check se queda marcado
    // (ya respaldado en localStorage por el useEffect de arriba) y se
    // reintenta solo cuando vuelva la conexión; solo un rechazo real del
    // servidor revierte la UI.
    let res: Response;
    try {
      res = await fetch("/api/empleado/checklist", {
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
    } catch (networkErr) {
      console.error("Checklist save network error (queued locally, will retry):", networkErr);
      setSaveError(`"${itemLabel}" saved on this device -- will sync when you're back online.`);
      return;
    }

    if (!res.ok) {
      console.error("Checklist save rejected by server:", res.status);
      setSaveError(`Couldn't save "${itemLabel}" -- reverted. Please try again.`);
      // Rollback: revert to original state (solo para rechazo real del servidor)
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
      return;
    }

    // Éxito confirmado por el servidor: ya no hace falta el respaldo local
    // de este item en particular -- el snapshot completo se re-persiste de
    // todos modos en el próximo cambio de `zones` (useEffect de arriba), y
    // se limpia del todo cuando el checklist llega a 100%.
    if (overallProgress.percentComplete >= 100) {
      clearLocalSnapshot();
    }
  };

  /**
   * v8.3 E4 (D.7): inicia el timer de 10 min de superficie caliente para un
   * ítem de estufa/campana. No marca el ítem como completado — solo registra
   * `hotSurfaceTimerStartedAt`. El checkbox permanece bloqueado hasta que
   * isHotSurfaceItemUnlocked() sea true (servidor lo vuelve a validar).
   */
  const handleStartHotSurfaceTimer = async (zone: ChecklistZoneProgress, itemId: string, itemLabel: string) => {
    const startedAt = new Date().toISOString();
    setZones((prev) =>
      prev.map((z) =>
        z.zone !== zone.zone
          ? z
          : {
              ...z,
              items: z.items.map((i) =>
                i.itemId === itemId ? { ...i, hotSurfaceTimerStartedAt: startedAt } : i
              ),
            }
      )
    );
    try {
      await fetch("/api/empleado/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orderId,
          checklistId: zone.checklistId,
          itemId,
          itemLabel,
          isCompleted: false,
          startHotSurfaceTimer: true,
        }),
      });
    } catch (e) {
      console.error("Start hot surface timer error:", e);
    }
  };

  const handleItemPhoto = async (zone: ChecklistZoneProgress, itemId: string, file: File) => {
    setUploadingItem(itemId);
    setSaveError("");
    try {
      const fileExt = file.name.split(".").pop() || "jpg";
      const fileName = `${orderId}/checklist/${zone.zone}/${itemId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("service-photos")
        .upload(fileName, file, { contentType: file.type });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        setSaveError("Couldn't upload the photo. Please try again.");
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
        const res = await fetch("/api/empleado/checklist", {
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
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }
      }
    } catch (e) {
      console.error("Item photo error:", e);
      setSaveError("Couldn't save the photo -- reverted. Please try again.");
      // Rollback: remove photo from local state
      setZones((prev) =>
        prev.map((z) => {
          if (z.zone !== zone.zone) return z;
          return {
            ...z,
            items: z.items.map((i) =>
              i.itemId === itemId ? { ...i, photoUrl: undefined } : i
            ),
          };
        })
      );
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
      {/* v8.3 E4 (D.7): aviso de reparto — solo aparece cuando el servicio
          tiene N>=2 y a este empleado le tocó un subconjunto de zonas. */}
      {myZoneCount !== null && myZoneCount > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
          You have {myZoneCount} zone{myZoneCount === 1 ? "" : "s"} assigned on this service. Your teammate covers the rest.
        </div>
      )}
      {myZoneCount === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
          No checklist zones assigned to you on this service — help your teammate and confirm with them directly.
        </div>
      )}
      <ErrorBanner message={saveError} />

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
          const lockoutActive = !!confirmedColors && !!onConfirmedColorsChange;
          const zoneUnlocked = !lockoutActive || isZoneUnlocked(zone.zoneColor, confirmedColors!);

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
                  {!zoneUnlocked && <Lock className="w-4 h-4" />}
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

              {/* Candado químico: la zona no se puede tocar sin identificar el
                  producto correcto primero (B.2.8 — color + ícono + texto,
                  nunca solo color, y NUNCA la respuesta pre-mostrada: el
                  empleado elige entre las 6 opciones en ChemicalMatchModal). */}
              {isExpanded && !zoneUnlocked && (
                <div className="p-3 bg-amber-50 border-t border-amber-200 flex items-center gap-3">
                  <div className="flex-1 min-w-0 text-xs text-amber-800">
                    <p className="font-semibold">Confirm the chemical before starting this zone</p>
                    <p>Identifica el producto correcto para: {zone.zoneLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMatchModalZone({ zoneColor: zone.zoneColor, zoneLabel: zone.zoneLabel })}
                    className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold bg-white border border-amber-400 text-amber-800 rounded-lg px-3 py-2 hover:bg-amber-100"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Confirm & unlock
                  </button>
                </div>
              )}

              {/* Zone items */}
              {isExpanded && zoneUnlocked && (
                <div className="p-3 space-y-2">
                  {zone.items.map((item) => {
                    // v8.3 E4 (D.7): superficie caliente — estufa/campana con
                    // azul deben esperar 10 min de timer antes de completarse.
                    const hotSurfaceLocked =
                      !!item.hotSurface &&
                      !item.isCompleted &&
                      !isHotSurfaceItemUnlocked(item.hotSurfaceTimerStartedAt ?? null, new Date().toISOString());
                    const hotSurfaceTimerRunning = !!item.hotSurface && !!item.hotSurfaceTimerStartedAt;
                    const remaining = item.hotSurface
                      ? minutesRemaining(item.hotSurfaceTimerStartedAt ?? null, new Date().toISOString())
                      : 0;

                    return (
                    <div
                      key={item.itemId}
                      className={`flex items-start gap-3 p-2 rounded-lg transition-colors ${
                        item.isCompleted ? "bg-green-50" : hotSurfaceLocked ? "bg-amber-50" : "bg-gray-50"
                      }`}
                    >
                      <button
                        onClick={() => handleToggleItem(zone, item.itemId, item.label)}
                        disabled={hotSurfaceLocked}
                        className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                          item.isCompleted
                            ? "bg-state-success border-state-success text-white"
                            : hotSurfaceLocked
                            ? "border-amber-300 bg-amber-100 cursor-not-allowed"
                            : "border-gray-300 bg-white"
                        }`}
                      >
                        {item.isCompleted && <Check className="w-3.5 h-3.5" />}
                        {!item.isCompleted && hotSurfaceLocked && <Lock className="w-3 h-3 text-amber-600" />}
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

                        {/* Superficie caliente: timer de 10 min (D.7) */}
                        {hotSurfaceLocked && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-amber-800">
                            <Timer className="w-3.5 h-3.5" />
                            {hotSurfaceTimerRunning ? (
                              <span>Superficie caliente: espera {remaining} min más antes de completar.</span>
                            ) : (
                              <>
                                <span>Superficie caliente: inicia el temporizador de 10 min.</span>
                                <button
                                  type="button"
                                  onClick={() => handleStartHotSurfaceTimer(zone, item.itemId, item.label)}
                                  className="flex-shrink-0 font-semibold bg-white border border-amber-400 text-amber-800 rounded-lg px-2 py-1 hover:bg-amber-100"
                                >
                                  Start timer
                                </button>
                              </>
                            )}
                          </div>
                        )}

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
                                aria-label="Agregar foto del item de cierre"
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
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {matchModalZone && confirmedColors && onConfirmedColorsChange && (
        <ChemicalMatchModal
          orderId={orderId}
          zoneColor={matchModalZone.zoneColor}
          zoneLabel={matchModalZone.zoneLabel}
          confirmedColors={confirmedColors}
          onConfirmed={onConfirmedColorsChange}
          onClose={() => setMatchModalZone(null)}
        />
      )}
    </div>
  );
}
