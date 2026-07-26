"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  Edit2,
  Trash2,
  AlertCircle,
  Check,
  X,
  GripVertical,
  Palette,
  Smile,
  ListChecks,
  MoreHorizontal,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useFocusTrap } from "@/lib/useFocusTrap";

interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  active?: boolean;
}

interface ChecklistZone {
  id: string;
  service_subtype: string;
  zone: string;
  zone_label: string;
  zone_color: string;
  zone_icon: string;
  items: ChecklistItem[];
  sort_order: number;
  /** v8.3 E4 (D.7): peso/dificultad de la zona — usado en el reparto de zonas por operario (zone-reparto.ts). */
  zone_weight: number;
  /** v8.3 E4 (D.7): "tiempo estimado" — solo importa cuando is_addon_zone=true. */
  zone_time_hours: number;
  /** v8.3 E4 (D.7): true = zona opcional que NO está en la tabla HHE base; se ofrece como add-on en el cotizador. */
  is_addon_zone: boolean;
  is_active: boolean;
  created_at: string;
}

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  confirmLabel?: string;
  danger?: boolean;
  extraAction?: {
    label: string;
    onClick: () => void;
  };
}

const DEFAULT_ITEMS: ChecklistItem[] = [
  { id: "", label: "", required: true, active: true },
];

export default function AdminChecklistsClient() {
  const t = useTranslations("admin.checklists");

  const COLORS = [
    { key: "red", label: t("colorRed"), class: "bg-red-500" },
    { key: "blue", label: t("colorBlue"), class: "bg-blue-500" },
    { key: "green", label: t("colorGreen"), class: "bg-green-500" },
    { key: "yellow", label: t("colorYellow"), class: "bg-yellow-500" },
    { key: "white", label: t("colorWhite"), class: "bg-gray-200 border border-gray-300" },
    { key: "black", label: t("colorBlack"), class: "bg-gray-800" },
  ];

  const [checklists, setChecklists] = useState<ChecklistZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingZone, setEditingZone] = useState<ChecklistZone | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [openZoneMenu, setOpenZoneMenu] = useState<string | null>(null);
  const [isAddingToExisting, setIsAddingToExisting] = useState(false);

  // Form state
  const [formServiceSubtype, setFormServiceSubtype] = useState("");
  const [formZone, setFormZone] = useState("");
  const [formZoneLabel, setFormZoneLabel] = useState("");
  const [formZoneColor, setFormZoneColor] = useState("red");
  const [formZoneIcon, setFormZoneIcon] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [formZoneWeight, setFormZoneWeight] = useState(1.0);
  const [formZoneTimeHours, setFormZoneTimeHours] = useState(0.5);
  const [formIsAddonZone, setFormIsAddonZone] = useState(false);
  const [formItems, setFormItems] = useState<ChecklistItem[]>(JSON.parse(JSON.stringify(DEFAULT_ITEMS)));

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, showModal);
  const confirmDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(confirmDialogRef, !!confirmDialog?.open);

  useEffect(() => {
    loadChecklists();
  }, []);

  // Close zone menu when clicking outside
  useEffect(() => {
    if (!openZoneMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-zone-menu]")) {
        setOpenZoneMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openZoneMenu]);

  // Item 5/9 (auditoría 2026-07-25): el modal de zona y el diálogo de
  // confirmación no cerraban con Escape. Se agrega manejo global de teclado
  // -- el diálogo de confirmación tiene prioridad si ambos están abiertos.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmDialog?.open) {
        setConfirmDialog(null);
      } else if (showModal) {
        setShowModal(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmDialog, showModal]);

  async function loadChecklists() {
    setLoading(true);
    setError(""); // Limpiar error previo
    try {
      const res = await fetch("/api/admin/checklists", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorLoadFailed"));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setChecklists(data.checklists || []);
      // Expand all by default
      const subtypes = new Set<string>((data.checklists || []).map((c: ChecklistZone) => c.service_subtype));
      setExpandedGroups(subtypes);
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }

  const grouped = React.useMemo(() => {
    const map = new Map<string, ChecklistZone[]>();
    for (const c of checklists) {
      if (!map.has(c.service_subtype)) map.set(c.service_subtype, []);
      map.get(c.service_subtype)!.push(c);
    }
    return map;
  }, [checklists]);

  const toggleGroup = (subtype: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(subtype)) next.delete(subtype);
      else next.add(subtype);
      return next;
    });
  };

  const openNew = (subtype: string = "") => {
    setEditingZone(null);
    setFormServiceSubtype(subtype);
    setIsAddingToExisting(!!subtype); // true when adding to existing service type
    setFormZone("");
    setFormZoneLabel("");
    setFormZoneColor("red");
    setFormZoneIcon("");
    setFormSortOrder(0);
    setFormZoneWeight(1.0);
    setFormZoneTimeHours(0.5);
    setFormIsAddonZone(false);
    setFormItems(JSON.parse(JSON.stringify(DEFAULT_ITEMS)));
    setShowModal(true);
  };

  const openEdit = (zone: ChecklistZone) => {
    setEditingZone(zone);
    setFormServiceSubtype(zone.service_subtype);
    setFormZone(zone.zone);
    setFormZoneLabel(zone.zone_label);
    setFormZoneColor(zone.zone_color);
    setFormZoneIcon(zone.zone_icon);
    setFormSortOrder(zone.sort_order);
    setFormZoneWeight(zone.zone_weight ?? 1.0);
    setFormZoneTimeHours(zone.zone_time_hours ?? 0.5);
    setFormIsAddonZone(zone.is_addon_zone ?? false);
    setFormItems(JSON.parse(JSON.stringify(zone.items || [])));
    setShowModal(true);
  };

  const addItem = () => {
    setFormItems((prev) => [
      ...prev,
      { id: "", label: "", required: true, active: true },
    ]);
  };

  const updateItem = (index: number, field: keyof ChecklistItem, value: string | boolean) => {
    setFormItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const removeItem = async (index: number) => {
    const item = formItems[index];
    // New items without real IDs can be removed directly
    if (!item.id || item.id.startsWith("temp-")) {
      setFormItems((prev) => prev.filter((_, i) => i !== index));
      return;
    }

    // Existing items: check history first
    if (!editingZone) {
      setFormItems((prev) =>
        prev.map((it, i) => (i === index ? { ...it, active: false } : it))
      );
      return;
    }

    const { data: hasHistory } = await supabase.rpc("check_item_history", {
      p_item_id: item.id,
      p_checklist_id: editingZone.id,
    });

    if (hasHistory) {
      setFormItems((prev) =>
        prev.map((it, i) => (i === index ? { ...it, active: false } : it))
      );
    } else {
      setConfirmDialog({
        open: true,
        title: t("deleteItemTitle"),
        message: t("deleteItemMessage"),
        onConfirm: () => {
          setFormItems((prev) => prev.filter((_, i) => i !== index));
          setConfirmDialog(null);
        },
        confirmLabel: t("deletePermanently"),
        danger: true,
        extraAction: {
          label: t("deactivate"),
          onClick: () => {
            setFormItems((prev) =>
              prev.map((it, i) => (i === index ? { ...it, active: false } : it))
            );
            setConfirmDialog(null);
          },
        },
      });
    }
  };

  const restoreItem = (index: number) => {
    setFormItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, active: true } : item))
    );
  };

  const handleSubmit = async () => {
    if (!formServiceSubtype || !formZone || !formZoneLabel) return;

    // Filter out empty items (no label or only whitespace), keep active ones and inactive ones with history
    const validItems = formItems.filter((item) => item.label.trim().length > 0 || item.active === false);
    if (validItems.length === 0) return;

    // Additional validation: reject if any active item has empty label
    const emptyActiveItems = formItems.filter((item) => item.active !== false && item.label.trim().length === 0);
    if (emptyActiveItems.length > 0) {
      setError(t("errorAllActiveNeedDescription"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        service_subtype: formServiceSubtype,
        zone: formZone,
        zone_label: formZoneLabel,
        zone_color: formZoneColor,
        zone_icon: formZoneIcon || "📋",
        items: validItems,
        sort_order: Math.max(0, formSortOrder),
        zone_weight: formZoneWeight > 0 ? formZoneWeight : 1.0,
        zone_time_hours: formZoneTimeHours >= 0 ? formZoneTimeHours : 0.5,
        is_addon_zone: formIsAddonZone,
      };

      let res;
      if (editingZone) {
        res = await fetch(`/api/admin/checklists/${editingZone.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/admin/checklists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        setShowModal(false);
        await loadChecklists();
      } else {
        const err = await res.json();
        setError(err.error || t("errorSaveFailed"));
      }
    } catch {
      setError(t("errorNetworkSave"));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteZone = async (zoneId: string, zoneLabel: string) => {
    setError(""); // Limpiar error previo
    try {
      const { data: hasHistory, error: rpcError } = await supabase.rpc(
        "check_zone_history",
        { p_checklist_id: zoneId }
      );

      if (rpcError) {
        setError(t("errorHistoryCheckFailed"));
        return;
      }

      if (hasHistory) {
        // Zone has usage history — only deactivation allowed
        setConfirmDialog({
          open: true,
          title: t("deactivateZoneTitle"),
          message: t("deactivateZoneMessage"),
          onConfirm: async () => {
            const res = await fetch(`/api/admin/checklists/${zoneId}`, {
              method: "DELETE",
              credentials: "include",
            });
            if (res.ok) {
              await loadChecklists();
            } else {
              setError(t("errorDeactivateFailed"));
            }
            setConfirmDialog(null);
          },
          confirmLabel: t("deactivate"),
        });
      } else {
        // No history — offer both deactivate and permanent delete
        setConfirmDialog({
          open: true,
          title: t("deleteZoneTitle"),
          message: t("deleteZoneMessage", { zone: zoneLabel }),
          onConfirm: async () => {
            // Deactivate (soft delete)
            const res = await fetch(`/api/admin/checklists/${zoneId}`, {
              method: "DELETE",
              credentials: "include",
            });
            if (res.ok) {
              await loadChecklists();
            } else {
              setError(t("errorDeactivateFailed"));
            }
            setConfirmDialog(null);
          },
          confirmLabel: t("deactivate"),
          extraAction: {
            label: t("deletePermanently"),
            onClick: async () => {
              const res = await fetch(`/api/admin/checklists/${zoneId}?force=true`, {
                method: "DELETE",
                credentials: "include",
              });
              if (res.ok) {
                await loadChecklists();
              } else {
                setError(t("errorHardDeleteFailed"));
              }
              setConfirmDialog(null);
              setOpenZoneMenu(null);
            },
          },
        });
      }
    } catch {
      setError(t("errorDeleteZoneFailed"));
    }
  };

  const handleDeleteServiceType = async (subtype: string) => {
    // Check history first (soft-check via DELETE with dry-run)
    const res = await fetch(`/api/admin/checklists/service-type/${encodeURIComponent(subtype)}?dryRun=true`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 409) {
      setError(t("cannotDelete"));
      return;
    }
    if (!res.ok && res.status !== 404) {
      setError(t("errorDeleteServiceTypeFailed"));
      return;
    }
    // Show confirmation before actual delete
    setConfirmDialog({
      open: true,
      title: t("deleteServiceTypeTitle"),
      message: t("deleteServiceTypeMessage", { subtype: subtype.replace(/_/g, " ") }),
      onConfirm: async () => {
        const res2 = await fetch(`/api/admin/checklists/service-type/${encodeURIComponent(subtype)}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (res2.ok) {
          await loadChecklists();
        } else {
          setError(t("errorDeleteServiceTypeFailed"));
        }
        setConfirmDialog(null);
      },
      confirmLabel: t("deletePermanently"),
      danger: true,
    });
  };

  const getColorClass = (color: string) => {
    const c = COLORS.find((c) => c.key === color);
    return c?.class || "bg-gray-300";
  };

  const activeItems = (items: ChecklistItem[]) => items.filter((i) => i.active !== false);

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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <button
          type="button"
          onClick={() => openNew()}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-brand-navy/90"
        >
          <Plus className="w-4 h-4" />
          {t("newServiceType")}
        </button>
      </div>

      {Array.from(grouped.entries()).map(([subtype, zones]) => {
        const isExpanded = expandedGroups.has(subtype);
        const activeZones = zones.filter((z) => z.is_active);
        return (
          <div key={subtype} className="bg-white rounded-xl border overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup(subtype)}
              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ListChecks className="w-5 h-5 text-brand-navy" />
                <span className="font-semibold text-brand-ink capitalize">
                  {subtype.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-gray-400">
                  {t("zoneCount", { count: activeZones.length })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openNew(subtype);
                  }}
                  className="text-xs bg-brand-navy text-white px-2 py-1 rounded hover:bg-brand-navy/90"
                >
                  {t("addZone")}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteServiceType(subtype);
                  }}
                  className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                >
                  {t("deletePermanently")}
                </button>
                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="divide-y">
                {zones.map((zone) => (
                  <div
                    key={zone.id}
                    className={`p-4 flex items-start justify-between gap-3 ${
                      !zone.is_active ? "bg-gray-50 opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3 flex-1">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${getColorClass(
                          zone.zone_color
                        )}`}
                      >
                        {zone.zone_icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-brand-ink">{zone.zone_label}</span>
                          {!zone.is_active && (
                            <span className="text-xs text-gray-400 bg-gray-200 px-1.5 rounded">
                              {t("inactive")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {t("itemsSummary", {
                            count: activeItems(zone.items).length,
                            order: zone.sort_order,
                            weight: zone.zone_weight ?? 1.0,
                          })}
                          {zone.is_addon_zone && (
                            <span className="ml-2 text-brand-gold-dark font-medium">
                              {t("addonInQuote", { hours: zone.zone_time_hours ?? 0.5 })}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {activeItems(zone.items).map((item) => (
                            <span
                              key={item.id}
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                item.required
                                  ? "bg-red-50 text-red-600 border border-red-100"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {item.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 relative">
                      <button
                        type="button"
                        onClick={() => openEdit(zone)}
                        aria-label={t("editZoneAria", { zone: zone.zone_label })}
                        className="p-1.5 text-gray-400 hover:text-brand-navy transition-colors"
                      >
                        <Edit2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                      {zone.is_active && (
                        <button
                          type="button"
                          onClick={() => handleDeleteZone(zone.id, zone.zone_label)}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                          title={t("deactivate")}
                          aria-label={t("deactivateZoneAria", { zone: zone.zone_label })}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenZoneMenu(openZoneMenu === zone.id ? null : zone.id)}
                        className="p-1.5 text-gray-400 hover:text-brand-navy transition-colors"
                        title={t("moreOptions")}
                        aria-label={t("moreOptionsAria", { zone: zone.zone_label })}
                        aria-expanded={openZoneMenu === zone.id}
                        data-zone-menu
                      >
                        <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                      </button>
                      {openZoneMenu === zone.id && (
                        <div data-zone-menu className="absolute right-0 top-8 bg-white border rounded-lg shadow-lg z-10 w-40">
                          <button
                            type="button"
                            onClick={() => {
                              handleDeleteZone(zone.id, zone.zone_label);
                              setOpenZoneMenu(null);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            {t("delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {grouped.size === 0 && (
        <div className="bg-white rounded-xl border p-8 text-center">
          <ListChecks className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("noChecklistsFound")}</p>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog?.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div ref={confirmDialogRef} role="alertdialog" aria-modal="true" className="bg-white rounded-xl shadow-elevation-2 w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-brand-ink">{confirmDialog.title}</h3>
            <p className="text-sm text-gray-600">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                {t("cancel")}
              </button>
              {confirmDialog.extraAction && (
                <button
                  type="button"
                  onClick={confirmDialog.extraAction.onClick}
                  aria-label={confirmDialog.extraAction.label}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  {confirmDialog.extraAction.label}
                </button>
              )}
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                aria-label={confirmDialog.confirmLabel || t("confirm")}
                className={`px-4 py-2 text-sm rounded-lg font-medium ${
                  confirmDialog.danger
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-brand-navy text-white hover:bg-brand-navy/90"
                }`}
              >
                {confirmDialog.confirmLabel || t("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div ref={modalRef} role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-elevation-2 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-brand-ink">
                  {editingZone ? t("editZoneTitle") : t("newZoneTitle")}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  aria-label={t("closeDialog")}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              {/* Service Subtype — hidden when adding to existing service type */}
              {isAddingToExisting ? (
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <span className="text-gray-500">{t("addingTo")} </span>
                  <span className="font-medium text-brand-ink capitalize">
                    {formServiceSubtype.replace(/_/g, " ")}
                  </span>
                </div>
              ) : (
                <div>
                  <label htmlFor="checklist-service-type" className="block text-sm font-medium text-gray-700 mb-1">
                    {t("serviceType")}
                  </label>
                  <input
                    id="checklist-service-type"
                    type="text"
                    value={formServiceSubtype}
                    onChange={(e) => setFormServiceSubtype(e.target.value)}
                    placeholder={t("serviceTypePlaceholder")}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                  />
                </div>
              )}

              {/* Zone code + label */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="checklist-zone-code" className="block text-sm font-medium text-gray-700 mb-1">
                    {t("zoneCode")}
                  </label>
                  <input
                    id="checklist-zone-code"
                    type="text"
                    value={formZone}
                    onChange={(e) => setFormZone(e.target.value)}
                    placeholder={t("zoneCodePlaceholder")}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                    disabled={!!editingZone}
                  />
                </div>
                <div>
                  <label htmlFor="checklist-zone-label" className="block text-sm font-medium text-gray-700 mb-1">
                    {t("zoneLabel")}
                  </label>
                  <input
                    id="checklist-zone-label"
                    type="text"
                    value={formZoneLabel}
                    onChange={(e) => setFormZoneLabel(e.target.value)}
                    placeholder={t("zoneLabelPlaceholder")}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                  />
                </div>
              </div>

              {/* Color + Icon */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Palette className="w-3.5 h-3.5 inline mr-1" />
                    {t("color")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => (
                      <button
                        type="button"
                        key={c.key}
                        onClick={() => setFormZoneColor(c.key)}
                        className={`w-8 h-8 rounded-lg ${c.class} ${
                          formZoneColor === c.key
                            ? "ring-2 ring-offset-2 ring-brand-gold"
                            : ""
                        }`}
                        title={c.label}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="checklist-zone-icon" className="block text-sm font-medium text-gray-700 mb-1">
                    <Smile className="w-3.5 h-3.5 inline mr-1" />
                    {t("icon")}
                  </label>
                  <input
                    id="checklist-zone-icon"
                    type="text"
                    value={formZoneIcon}
                    onChange={(e) => setFormZoneIcon(e.target.value)}
                    placeholder={t("iconPlaceholder")}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                  />
                </div>
              </div>

              {/* Sort Order + Zone Weight */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="checklist-sort-order" className="block text-sm font-medium text-gray-700 mb-1">
                    {t("sortOrder")}
                  </label>
                  <input
                    id="checklist-sort-order"
                    type="number"
                    min="0"
                    value={formSortOrder}
                    onChange={(e) => setFormSortOrder(Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="checklist-zone-weight" className="block text-sm font-medium text-gray-700 mb-1">
                    {t("zoneWeight")}
                  </label>
                  <input
                    id="checklist-zone-weight"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={formZoneWeight}
                    onChange={(e) => setFormZoneWeight(Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">{t("zoneWeightHelper")}</p>
                </div>
              </div>

              {/* v8.3 E4 (D.7): "agregar zona = nombre + peso + tiempo estimado, y
                  aparece automáticamente en cotización, reparto y checklist".
                  Marcar esta zona como add-on la agrega también al cotizador —
                  decisión explícita del admin, nunca automática (protege el
                  piso de margen y la transparencia de precio). */}
              <div className="bg-brand-ice rounded-lg p-3 space-y-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={t("addonCheckboxAria")}
                    className="mt-0.5"
                    checked={formIsAddonZone}
                    onChange={(e) => setFormIsAddonZone(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium text-brand-ink">{t("addonLabel")}</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t("addonDescription")}
                    </p>
                  </span>
                </label>
                {formIsAddonZone && (
                  <div>
                    <label htmlFor="checklist-zone-time-hours" className="block text-sm font-medium text-gray-700 mb-1">
                      {t("estimatedAddonTime")}
                    </label>
                    <input
                      id="checklist-zone-time-hours"
                      type="number"
                      min="0"
                      step="0.25"
                      value={formZoneTimeHours}
                      onChange={(e) => setFormZoneTimeHours(Number(e.target.value))}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      {t("addonChargeHelper")}
                    </p>
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("items")}
                </label>
                <div className="space-y-2">
                  {formItems.map((item, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-2 p-2 rounded-lg border ${
                        item.active === false
                          ? "bg-gray-50 opacity-50 border-gray-200"
                          : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
                      <input
                        type="text"
                        aria-label={t("itemDescriptionAria", { index: index + 1 })}
                        value={item.label}
                        onChange={(e) => updateItem(index, "label", e.target.value)}
                        placeholder={t("itemDescriptionPlaceholder")}
                        className="flex-1 text-sm border rounded px-2 py-1 focus:ring-2 focus:ring-brand-gold outline-none"
                        disabled={item.active === false}
                      />
                      <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                        <input
                          type="checkbox"
                          aria-label={t("itemRequiredAria", { index: index + 1 })}
                          checked={item.required}
                          onChange={(e) => updateItem(index, "required", e.target.checked)}
                          disabled={item.active === false}
                        />
                        {t("required")}
                      </label>
                      {item.active === false ? (
                        <button
                          type="button"
                          onClick={() => restoreItem(index)}
                          className="text-xs text-green-600 hover:text-green-700"
                        >
                          {t("restore")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          aria-label={t("removeItemAria")}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addItem}
                  className="mt-2 inline-flex items-center gap-1 text-sm text-brand-navy font-medium"
                >
                  <Plus className="w-4 h-4" />
                  {t("addItem")}
                </button>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving || !formServiceSubtype || !formZone || !formZoneLabel}
                  aria-label={editingZone ? t("saveZoneAria") : t("createZoneAria")}
                  className="px-4 py-2 bg-brand-navy text-white rounded-lg font-medium text-sm hover:bg-brand-navy/90 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingZone ? t("saveChanges") : t("createZone")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
