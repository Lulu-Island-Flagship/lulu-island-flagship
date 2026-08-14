"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Package, Truck, Plus, Loader2, AlertTriangle, ShoppingCart, Check, Calendar, Tag } from "lucide-react";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";
import { formatVancouverDate } from "@/lib/date-utils";

interface Supplier {
  id: string;
  name: string;
  contact_name?: string;
  contact_phone?: string;
  lead_time_days: number;
}

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  reorder_threshold: number;
}

interface EquipmentReservation {
  id: string;
  inventory_item_id: string;
  reserved_date: string;
  assignment_id: string | null;
  inventory_items?: { id: string; name: string; category: string } | null;
}

interface CatalogEntry {
  id: string;
  supplier_id: string;
  inventory_item_id: string;
  unit_price_cents: number;
  currency: string;
  effective_from: string;
  is_current: boolean;
  suppliers?: { id: string; name: string } | null;
  inventory_items?: { id: string; name: string; unit: string } | null;
}

interface ReorderSuggestion {
  itemId: string;
  itemName: string;
  currentStock: number;
  reorderThreshold: number;
  deficit: number;
}

interface PurchaseOrder {
  id: string;
  status: string;
  generated_reason: string | null;
  created_at: string;
  purchase_order_lines: { id: string; inventory_item_id: string; quantity: number }[];
}

const CATEGORIES = [
  { value: "chemical", label: "Chemical" },
  { value: "cloth", label: "Cloth" },
  { value: "ppe", label: "PPE" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

export default function InventarioPage() {
  const t = useTranslations("admin.inventario");
  const [tab, setTab] = useState<"items" | "suppliers" | "equipment">("items");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [reservations, setReservations] = useState<EquipmentReservation[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [poBusy, setPoBusy] = useState(false);
  const [poError, setPoError] = useState("");

  const [itemForm, setItemForm] = useState({
    name: "", category: "chemical", unit: "L", currentStock: "", reorderThreshold: "",
  });
  const [supplierForm, setSupplierForm] = useState({
    name: "", contactName: "", contactPhone: "", contactEmail: "", leadTimeDays: "3",
  });
  const [reservationForm, setReservationForm] = useState({ inventoryItemId: "", reservedDate: "" });
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [catalogForm, setCatalogForm] = useState({ supplierId: "", inventoryItemId: "", unitPrice: "" });
  const [saving, setSaving] = useState(false);
  // Fix (auditoría externa 2026-07-31, items 13/14/15): generatePO y
  // approvePO no pedían confirmación antes de generar/aprobar una orden de
  // compra real -- se agregan modales de confirmación que muestran
  // productos/montos. El título/subtítulo del encabezado estaba hardcodeado
  // en inglés -- ahora usa useTranslations. El stock actual del formulario
  // de alta de producto no tenía piso en 0.
  const [showGeneratePoConfirm, setShowGeneratePoConfirm] = useState(false);
  const [confirmApprovePo, setConfirmApprovePo] = useState<PurchaseOrder | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [itemsRes, suppliersRes, poRes, reservationsRes, catalogRes] = await Promise.all([
        fetch("/api/admin/inventory-items", { credentials: "include" }),
        fetch("/api/admin/suppliers", { credentials: "include" }),
        fetch("/api/admin/purchase-orders", { credentials: "include" }),
        fetch("/api/admin/equipment-reservations", { credentials: "include" }),
        fetch("/api/admin/supplier-catalog", { credentials: "include" }),
      ]);
      if (itemsRes.ok) {
        const d = await itemsRes.json();
        setItems(d.items || []);
        setSuggestions(d.reorderSuggestions || []);
      }
      if (suppliersRes.ok) {
        const d = await suppliersRes.json();
        setSuppliers(d.suppliers || []);
      }
      if (poRes.ok) {
        const d = await poRes.json();
        setPurchaseOrders(d.purchaseOrders || []);
      }
      if (reservationsRes.ok) {
        const d = await reservationsRes.json();
        setReservations(d.reservations || []);
      }
      if (catalogRes.ok) {
        const d = await catalogRes.json();
        setCatalog(d.catalog || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function addReservation(e: React.FormEvent) {
    e.preventDefault();
    setReservationError(null);
    if (!reservationForm.inventoryItemId || !reservationForm.reservedDate) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/equipment-reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          inventoryItemId: reservationForm.inventoryItemId,
          reservedDate: reservationForm.reservedDate,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setReservationError(d.error || "Could not create the reservation.");
        return;
      }
      setReservationForm({ inventoryItemId: "", reservedDate: "" });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function addCatalogEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!catalogForm.supplierId || !catalogForm.inventoryItemId || !catalogForm.unitPrice) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/supplier-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          supplierId: catalogForm.supplierId,
          inventoryItemId: catalogForm.inventoryItemId,
          unitPriceCents: Math.round(parseFloat(catalogForm.unitPrice) * 100),
        }),
      });
      if (res.ok) {
        setCatalogForm({ supplierId: "", inventoryItemId: "", unitPrice: "" });
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  const equipmentItems = items.filter((i) => i.category === "equipment");

  async function generatePO() {
    setPoBusy(true);
    setPoError("");
    try {
      const res = await fetch("/api/admin/purchase-orders", { method: "POST", credentials: "include" });
      const d = await res.json();
      if (!res.ok) {
        const message = d.error || t("purchaseOrderFailed");
        setPoError(message);
        throw new Error(message);
      }
      await load();
    } finally {
      setPoBusy(false);
    }
  }

  async function approvePO(id: string) {
    setPoBusy(true);
    try {
      const res = await fetch(`/api/admin/purchase-orders/${id}/approve`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || t("purchaseOrderFailed"));
      }
      await load();
    } finally {
      setPoBusy(false);
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!itemForm.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inventory-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: itemForm.name,
          category: itemForm.category,
          unit: itemForm.unit,
          currentStock: Math.max(0, parseFloat(itemForm.currentStock) || 0),
          reorderThreshold: Math.max(0, parseFloat(itemForm.reorderThreshold) || 0),
        }),
      });
      if (res.ok) {
        setItemForm({ name: "", category: "chemical", unit: "L", currentStock: "", reorderThreshold: "" });
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function addSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierForm.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: supplierForm.name,
          contactName: supplierForm.contactName || undefined,
          contactPhone: supplierForm.contactPhone || undefined,
          contactEmail: supplierForm.contactEmail || undefined,
          leadTimeDays: parseInt(supplierForm.leadTimeDays) || 3,
        }),
      });
      if (res.ok) {
        setSupplierForm({ name: "", contactName: "", contactPhone: "", contactEmail: "", leadTimeDays: "3" });
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-brand-ink mb-1">{t("pageTitle")}</h1>
        <p className="text-sm text-gray-600 mb-6">
          {t("pageSubtitle")}
        </p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab("items")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "items" ? "bg-brand-navy text-white" : "bg-white text-gray-600"}`}
          >
            <Package className="w-4 h-4 inline mr-1" /> Products
          </button>
          <button
            onClick={() => setTab("suppliers")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "suppliers" ? "bg-brand-navy text-white" : "bg-white text-gray-600"}`}
          >
            <Truck className="w-4 h-4 inline mr-1" /> Suppliers
          </button>
          <button
            onClick={() => setTab("equipment")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "equipment" ? "bg-brand-navy text-white" : "bg-white text-gray-600"}`}
          >
            <Calendar className="w-4 h-4 inline mr-1" /> Equipment
          </button>
        </div>

        {poError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
            {poError}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 text-sm text-yellow-800">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4" /> {suggestions.length} product(s) below threshold
              </div>
              <button
                onClick={() => setShowGeneratePoConfirm(true)}
                disabled={poBusy}
                className="flex items-center gap-1 bg-brand-navy text-white px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                <ShoppingCart className="w-3.5 h-3.5" /> Generate purchase order
              </button>
            </div>
            {suggestions.map((s) => (
              <p key={s.itemId}>{s.itemName}: {s.currentStock} (threshold {s.reorderThreshold})</p>
            ))}
          </div>
        )}

        {purchaseOrders.length > 0 && (
          <div className="bg-white rounded-xl shadow-elevation-1 divide-y mb-4">
            <div className="p-3 text-sm font-semibold text-brand-ink flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" /> Purchase orders
            </div>
            {purchaseOrders.map((po) => (
              <div key={po.id} className="p-3 text-sm flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500">{formatVancouverDate(po.created_at, "en")}</p>
                  <p className="text-gray-700">{po.generated_reason}</p>
                  <p className="text-xs mt-1">
                    Status: <span className="font-medium">{po.status}</span>
                  </p>
                </div>
                {po.status === "pending_approval" && (
                  <button
                    onClick={() => setConfirmApprovePo(po)}
                    disabled={poBusy}
                    className="flex items-center gap-1 bg-state-success text-white px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-50 flex-shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-brand-gold-dark" />
        ) : tab === "items" ? (
          <>

            <form onSubmit={addItem} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3 mb-4">
              <h2 className="text-sm font-semibold text-brand-ink">{t("addProduct")}</h2>
              <input
                type="text" aria-label={t("productName")} placeholder={t("productNamePlaceholder")} value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                className="w-full text-sm border rounded-lg px-3 py-2"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label={t("productCategory")}
                  value={itemForm.category}
                  onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                >
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <input
                  type="text" aria-label={t("productUnit")} placeholder={t("unitPlaceholder")} value={itemForm.unit}
                  onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="number" min="0" aria-label={t("currentStock")} placeholder={t("currentStockPlaceholder")} value={itemForm.currentStock}
                  onChange={(e) => setItemForm({ ...itemForm, currentStock: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="number" min="0" aria-label={t("reorderThreshold")} placeholder={t("reorderThresholdPlaceholder")} value={itemForm.reorderThreshold}
                  onChange={(e) => setItemForm({ ...itemForm, reorderThreshold: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
              </div>
              <button type="submit" disabled={saving} className="flex items-center gap-1 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                <Plus className="w-4 h-4" /> {t("add")}
              </button>
            </form>

            <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
              {items.length === 0 && <p className="p-4 text-sm text-gray-500">{t("noProducts")}</p>}
              {items.map((i) => (
                <div key={i.id} className="p-3 flex justify-between text-sm">
                  <span className="font-medium">{i.name}</span>
                  <span className="text-gray-500">{i.current_stock} {i.unit} (threshold {i.reorder_threshold})</span>
                </div>
              ))}
            </div>
          </>
        ) : tab === "suppliers" ? (
          <>
            <form onSubmit={addSupplier} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3 mb-4">
              <h2 className="text-sm font-semibold text-brand-ink">{t("addSupplier")}</h2>
              <input
                type="text" aria-label={t("supplierName")} placeholder={t("supplierNamePlaceholder")} value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                className="w-full text-sm border rounded-lg px-3 py-2"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text" aria-label={t("contactName")} placeholder={t("contactNamePlaceholder")} value={supplierForm.contactName}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contactName: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="text" aria-label={t("contactPhone")} placeholder={t("contactPhonePlaceholder")} value={supplierForm.contactPhone}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contactPhone: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="email" aria-label={t("contactEmail")} placeholder={t("contactEmailPlaceholder")} value={supplierForm.contactEmail}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contactEmail: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="number" aria-label={t("leadTime")} placeholder={t("leadTimePlaceholder")} value={supplierForm.leadTimeDays}
                  onChange={(e) => setSupplierForm({ ...supplierForm, leadTimeDays: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
              </div>
              <button type="submit" disabled={saving} className="flex items-center gap-1 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                <Plus className="w-4 h-4" /> {t("add")}
              </button>
            </form>

            <div className="bg-white rounded-xl shadow-elevation-1 divide-y mb-4">
              {suppliers.length === 0 && <p className="p-4 text-sm text-gray-500">{t("noSuppliers")}</p>}
              {suppliers.map((s) => (
                <div key={s.id} className="p-3 text-sm">
                  <span className="font-medium">{s.name}</span>
                  {s.contact_name && <span className="text-gray-500"> — {s.contact_name}</span>}
                  {s.contact_phone && <span className="text-gray-500"> · {s.contact_phone}</span>}
                </div>
              ))}
            </div>

            <form onSubmit={addCatalogEntry} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3 mb-4">
              <h2 className="text-sm font-semibold text-brand-ink flex items-center gap-1">
                <Tag className="w-4 h-4" /> {t("registerPrice")}
              </h2>
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label={t("supplier")}
                  value={catalogForm.supplierId}
                  onChange={(e) => setCatalogForm({ ...catalogForm, supplierId: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                >
                  <option value="">{t("supplierPlaceholder")}</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select
                  aria-label={t("product")}
                  value={catalogForm.inventoryItemId}
                  onChange={(e) => setCatalogForm({ ...catalogForm, inventoryItemId: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                >
                  <option value="">{t("productPlaceholder")}</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <input
                  type="number" step="0.01" aria-label={t("unitPrice")} placeholder={t("unitPricePlaceholder")} value={catalogForm.unitPrice}
                  onChange={(e) => setCatalogForm({ ...catalogForm, unitPrice: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2 col-span-2"
                />
              </div>
              <button type="submit" disabled={saving} className="flex items-center gap-1 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                <Plus className="w-4 h-4" /> {t("setCurrentPrice")}
              </button>
            </form>

            <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
              <div className="p-3 text-sm font-semibold text-brand-ink">{t("currentPrices")}</div>
              {catalog.length === 0 && <p className="p-4 text-sm text-gray-500">{t("noPrices")}</p>}
              {catalog.map((c) => (
                <div key={c.id} className="p-3 flex justify-between text-sm">
                  <span className="font-medium">{c.inventory_items?.name} — {c.suppliers?.name}</span>
                  <span className="text-gray-500">
                    ${(c.unit_price_cents / 100).toFixed(2)} {c.currency} (since {formatVancouverDate(c.effective_from, "en")})
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <form onSubmit={addReservation} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3 mb-4">
              <h2 className="text-sm font-semibold text-brand-ink">{t("reserveEquipment")}</h2>
              <p className="text-xs text-gray-500">{t("reserveDescription")}</p>
              {reservationError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">{reservationError}</div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label={t("implement")}
                  value={reservationForm.inventoryItemId}
                  onChange={(e) => setReservationForm({ ...reservationForm, inventoryItemId: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                >
                  <option value="">{t("implementPlaceholder")}</option>
                  {equipmentItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <input
                  type="date" aria-label={t("reservationDate")} value={reservationForm.reservedDate}
                  onChange={(e) => setReservationForm({ ...reservationForm, reservedDate: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
              </div>
              <button type="submit" disabled={saving} className="flex items-center gap-1 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                <Plus className="w-4 h-4" /> {t("reserve")}
              </button>
              {equipmentItems.length === 0 && (
                <p className="text-xs text-gray-500">
                  {t("noEquipmentHint")}
                </p>
              )}
            </form>

            <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
              <div className="p-3 text-sm font-semibold text-brand-ink">{t("upcomingReservations")}</div>
              {reservations.length === 0 && <p className="p-4 text-sm text-gray-500">{t("noReservations")}</p>}
              {reservations.map((r) => (
                <div key={r.id} className="p-3 flex justify-between text-sm">
                  <span className="font-medium">{r.inventory_items?.name || r.inventory_item_id}</span>
                  <span className="text-gray-500">{formatVancouverDate(r.reserved_date, "en")}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showGeneratePoConfirm && (
        <ConfirmActionModal
          title={t("confirmGeneratePO.title")}
          message={
            <span>
              {t("confirmGeneratePO.message", { count: suggestions.length })}
              <span className="block mt-2 space-y-0.5">
                {suggestions.map((s) => (
                  <span key={s.itemId} className="block text-xs font-mono">
                    {s.itemName}: {s.currentStock} / {s.reorderThreshold} (deficit {s.deficit})
                  </span>
                ))}
              </span>
            </span>
          }
          confirmLabel={t("confirmGeneratePO.confirmLabel")}
          onCancel={() => setShowGeneratePoConfirm(false)}
          onConfirm={async () => {
            await generatePO();
            setShowGeneratePoConfirm(false);
          }}
        />
      )}

      {confirmApprovePo && (
        <ConfirmActionModal
          title={t("confirmApprovePO.title")}
          message={
            <span>
              {t("confirmApprovePO.message", { date: formatVancouverDate(confirmApprovePo.created_at, "en") })}
              <span className="block mt-2 space-y-0.5">
                {confirmApprovePo.purchase_order_lines.map((line) => {
                  const item = items.find((i) => i.id === line.inventory_item_id);
                  return (
                    <span key={line.id} className="block text-xs font-mono">
                      {item?.name || line.inventory_item_id}: {line.quantity} {item?.unit || ""}
                    </span>
                  );
                })}
              </span>
            </span>
          }
          confirmLabel={t("confirmApprovePO.confirmLabel")}
          onCancel={() => setConfirmApprovePo(null)}
          onConfirm={async () => {
            await approvePO(confirmApprovePo.id);
            setConfirmApprovePo(null);
          }}
        />
      )}
    </main>
  );
}
