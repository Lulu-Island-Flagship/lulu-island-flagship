"use client";

import React, { useState, useEffect } from "react";
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

const COLORS = [
  { key: "red", label: "Red", class: "bg-red-500" },
  { key: "blue", label: "Blue", class: "bg-blue-500" },
  { key: "green", label: "Green", class: "bg-green-500" },
  { key: "yellow", label: "Yellow", class: "bg-yellow-500" },
  { key: "white", label: "White", class: "bg-gray-200 border border-gray-300" },
  { key: "black", label: "Black", class: "bg-gray-800" },
];

const DEFAULT_ITEMS: ChecklistItem[] = [
  { id: "", label: "", required: true, active: true },
];

export default function AdminChecklistsClient() {
  const [checklists, setChecklists] = useState<ChecklistZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingZone, setEditingZone] = useState<ChecklistZone | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [openZoneMenu, setOpenZoneMenu] = useState<string | null>(null);

  // Form state
  const [formServiceSubtype, setFormServiceSubtype] = useState("");
  const [formZone, setFormZone] = useState("");
  const [formZoneLabel, setFormZoneLabel] = useState("");
  const [formZoneColor, setFormZoneColor] = useState("red");
  const [formZoneIcon, setFormZoneIcon] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [formItems, setFormItems] = useState<ChecklistItem[]>(JSON.parse(JSON.stringify(DEFAULT_ITEMS)));

  useEffect(() => {
    loadChecklists();
  }, []);

  async function loadChecklists() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/checklists", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load checklists");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setChecklists(data.checklists || []);
      // Expand all by default
      const subtypes = new Set<string>((data.checklists || []).map((c: ChecklistZone) => c.service_subtype));
      setExpandedGroups(subtypes);
    } catch {
      setError("Network error");
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
    setFormZone("");
    setFormZoneLabel("");
    setFormZoneColor("red");
    setFormZoneIcon("");
    setFormSortOrder(0);
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
        title: "Delete Item",
        message: "Delete this item permanently? This cannot be undone.",
        onConfirm: () => {
          setFormItems((prev) => prev.filter((_, i) => i !== index));
          setConfirmDialog(null);
        },
        confirmLabel: "Delete Permanently",
        danger: true,
        extraAction: {
          label: "Deactivate",
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

    // Filter out empty inactive items, keep active ones and inactive ones with history
    const validItems = formItems.filter((item) => item.label.trim() || item.active !== false);
    if (validItems.length === 0) return;

    setSaving(true);
    try {
      const payload = {
        service_subtype: formServiceSubtype,
        zone: formZone,
        zone_label: formZoneLabel,
        zone_color: formZoneColor,
        zone_icon: formZoneIcon || "📋",
        items: validItems,
        sort_order: formSortOrder,
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
        setError(err.error || "Save failed");
      }
    } catch {
      setError("Network error during save");
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm("Deactivate this zone? It will remain in the database for historical records.")) return;
    try {
      const res = await fetch(`/api/admin/checklists/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        await loadChecklists();
      }
    } catch {
      setError("Deactivate failed");
    }
  };

  const handleHardDeleteZone = async (zoneId: string) => {
    const res = await fetch(`/api/admin/checklists/${zoneId}?force=true`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 409) {
      alert("Cannot delete: this zone has usage history. Only deactivation is allowed.");
      return;
    }
    if (res.ok) {
      setConfirmDialog({
        open: true,
        title: "Delete Zone Permanently",
        message: "This will permanently delete this zone. This cannot be undone.",
        onConfirm: async () => {
          const res2 = await fetch(`/api/admin/checklists/${zoneId}?force=true`, {
            method: "DELETE",
            credentials: "include",
          });
          if (res2.ok) {
            await loadChecklists();
          } else {
            setError("Hard delete failed");
          }
          setConfirmDialog(null);
          setOpenZoneMenu(null);
        },
        confirmLabel: "Delete Permanently",
        danger: true,
      });
    } else {
      setError("Hard delete failed");
    }
  };

  const handleDeleteServiceType = async (subtype: string) => {
    const res = await fetch(`/api/admin/checklists/service-type/${encodeURIComponent(subtype)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 409) {
      alert("Cannot delete: this service type has usage history. You can only deactivate all zones.");
      return;
    }
    if (res.ok) {
      setConfirmDialog({
        open: true,
        title: "Delete Service Type Permanently",
        message: `This will permanently delete all zones for '${subtype.replace(/_/g, " ")}'. This cannot be undone.`,
        onConfirm: async () => {
          const res2 = await fetch(`/api/admin/checklists/service-type/${encodeURIComponent(subtype)}`, {
            method: "DELETE",
            credentials: "include",
          });
          if (res2.ok) {
            await loadChecklists();
          } else {
            setError("Delete service type failed");
          }
          setConfirmDialog(null);
        },
        confirmLabel: "Delete Permanently",
        danger: true,
      });
    } else {
      setError("Delete service type failed");
    }
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
        <h1 className="text-2xl font-bold text-brand-ink">SOP Checklists</h1>
        <button
          onClick={() => openNew()}
          className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-brand-navy/90"
        >
          <Plus className="w-4 h-4" />
          New Service Type
        </button>
      </div>

      {Array.from(grouped.entries()).map(([subtype, zones]) => {
        const isExpanded = expandedGroups.has(subtype);
        const activeZones = zones.filter((z) => z.is_active);
        return (
          <div key={subtype} className="bg-white rounded-xl border overflow-hidden">
            <button
              onClick={() => toggleGroup(subtype)}
              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ListChecks className="w-5 h-5 text-brand-navy" />
                <span className="font-semibold text-brand-ink capitalize">
                  {subtype.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-gray-400">
                  {activeZones.length} zone{activeZones.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openNew(subtype);
                  }}
                  className="text-xs bg-brand-navy text-white px-2 py-1 rounded hover:bg-brand-navy/90"
                >
                  Add Zone
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteServiceType(subtype);
                  }}
                  className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                >
                  Delete Permanently
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
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {activeItems(zone.items).length} items · Order {zone.sort_order}
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
                        onClick={() => openEdit(zone)}
                        className="p-1.5 text-gray-400 hover:text-brand-navy transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {zone.is_active && (
                        <button
                          onClick={() => handleDeactivate(zone.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                          title="Deactivate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => setOpenZoneMenu(openZoneMenu === zone.id ? null : zone.id)}
                        className="p-1.5 text-gray-400 hover:text-brand-navy transition-colors"
                        title="More options"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {openZoneMenu === zone.id && (
                        <div className="absolute right-0 top-8 bg-white border rounded-lg shadow-lg z-10 w-40">
                          <button
                            onClick={() => {
                              handleHardDeleteZone(zone.id);
                              setOpenZoneMenu(null);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            Delete Permanently
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
          <p className="text-gray-500">No checklists found. Create your first one.</p>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog?.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-elevation-2 w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-brand-ink">{confirmDialog.title}</h3>
            <p className="text-sm text-gray-600">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              {confirmDialog.extraAction && (
                <button
                  onClick={confirmDialog.extraAction.onClick}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  {confirmDialog.extraAction.label}
                </button>
              )}
              <button
                onClick={confirmDialog.onConfirm}
                className={`px-4 py-2 text-sm rounded-lg font-medium ${
                  confirmDialog.danger
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-brand-navy text-white hover:bg-brand-navy/90"
                }`}
              >
                {confirmDialog.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-elevation-2 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-brand-ink">
                  {editingZone ? "Edit Zone" : "New Zone"}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Service Subtype */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Service Type
                </label>
                <input
                  type="text"
                  value={formServiceSubtype}
                  onChange={(e) => setFormServiceSubtype(e.target.value)}
                  placeholder="e.g. first_time, regular, airbnb"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                  disabled={!!editingZone}
                />
              </div>

              {/* Zone code + label */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Zone Code
                  </label>
                  <input
                    type="text"
                    value={formZone}
                    onChange={(e) => setFormZone(e.target.value)}
                    placeholder="e.g. bathroom"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                    disabled={!!editingZone}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Zone Label
                  </label>
                  <input
                    type="text"
                    value={formZoneLabel}
                    onChange={(e) => setFormZoneLabel(e.target.value)}
                    placeholder="e.g. Baño"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                  />
                </div>
              </div>

              {/* Color + Icon */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Palette className="w-3.5 h-3.5 inline mr-1" />
                    Color
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => (
                      <button
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Smile className="w-3.5 h-3.5 inline mr-1" />
                    Icon
                  </label>
                  <input
                    type="text"
                    value={formZoneIcon}
                    onChange={(e) => setFormZoneIcon(e.target.value)}
                    placeholder="e.g. 🚽"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                  />
                </div>
              </div>

              {/* Sort Order */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sort Order
                </label>
                <input
                  type="number"
                  value={formSortOrder}
                  onChange={(e) => setFormSortOrder(Number(e.target.value))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                />
              </div>

              {/* Items */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Items
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
                        value={item.label}
                        onChange={(e) => updateItem(index, "label", e.target.value)}
                        placeholder="Item description"
                        className="flex-1 text-sm border rounded px-2 py-1 focus:ring-2 focus:ring-brand-gold outline-none"
                        disabled={item.active === false}
                      />
                      <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={item.required}
                          onChange={(e) => updateItem(index, "required", e.target.checked)}
                          disabled={item.active === false}
                        />
                        Required
                      </label>
                      {item.active === false ? (
                        <button
                          onClick={() => restoreItem(index)}
                          className="text-xs text-green-600 hover:text-green-700"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => removeItem(index)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={addItem}
                  className="mt-2 inline-flex items-center gap-1 text-sm text-brand-navy font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </button>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving || !formServiceSubtype || !formZone || !formZoneLabel}
                  className="px-4 py-2 bg-brand-navy text-white rounded-lg font-medium text-sm hover:bg-brand-navy/90 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingZone ? "Save Changes" : "Create Zone"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
