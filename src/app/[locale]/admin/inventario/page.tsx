"use client";

import React, { useState, useEffect } from "react";
import { Package, Truck, Plus, Loader2, AlertTriangle, ShoppingCart, Check } from "lucide-react";

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
  { value: "chemical", label: "Químico" },
  { value: "cloth", label: "Paño" },
  { value: "ppe", label: "EPP" },
  { value: "equipment", label: "Equipo" },
  { value: "other", label: "Otro" },
];

export default function InventarioPage() {
  const [tab, setTab] = useState<"items" | "suppliers">("items");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [poBusy, setPoBusy] = useState(false);

  const [itemForm, setItemForm] = useState({
    name: "", category: "chemical", unit: "L", currentStock: "", reorderThreshold: "",
  });
  const [supplierForm, setSupplierForm] = useState({
    name: "", contactName: "", contactPhone: "", contactEmail: "", leadTimeDays: "3",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [itemsRes, suppliersRes, poRes] = await Promise.all([
        fetch("/api/admin/inventory-items", { credentials: "include" }),
        fetch("/api/admin/suppliers", { credentials: "include" }),
        fetch("/api/admin/purchase-orders", { credentials: "include" }),
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
    } finally {
      setLoading(false);
    }
  }

  async function generatePO() {
    setPoBusy(true);
    try {
      const res = await fetch("/api/admin/purchase-orders", { method: "POST", credentials: "include" });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || "No se pudo generar la orden de compra.");
        return;
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
      if (res.ok) await load();
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
          currentStock: parseFloat(itemForm.currentStock) || 0,
          reorderThreshold: parseFloat(itemForm.reorderThreshold) || 0,
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
        <h1 className="text-xl font-bold text-brand-ink mb-1">Inventario y Proveedores</h1>
        <p className="text-sm text-gray-600 mb-6">
          Estructura lista — escribe tus productos y proveedores reales aquí.
        </p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab("items")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "items" ? "bg-brand-navy text-white" : "bg-white text-gray-600"}`}
          >
            <Package className="w-4 h-4 inline mr-1" /> Productos
          </button>
          <button
            onClick={() => setTab("suppliers")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "suppliers" ? "bg-brand-navy text-white" : "bg-white text-gray-600"}`}
          >
            <Truck className="w-4 h-4 inline mr-1" /> Proveedores
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 text-sm text-yellow-800">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4" /> {suggestions.length} producto(s) bajo el umbral
              </div>
              <button
                onClick={generatePO}
                disabled={poBusy}
                className="flex items-center gap-1 bg-brand-navy text-white px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                <ShoppingCart className="w-3.5 h-3.5" /> Generar orden de compra
              </button>
            </div>
            {suggestions.map((s) => (
              <p key={s.itemId}>{s.itemName}: {s.currentStock} (umbral {s.reorderThreshold})</p>
            ))}
          </div>
        )}

        {purchaseOrders.length > 0 && (
          <div className="bg-white rounded-xl shadow-elevation-1 divide-y mb-4">
            <div className="p-3 text-sm font-semibold text-brand-ink flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" /> Órdenes de compra
            </div>
            {purchaseOrders.map((po) => (
              <div key={po.id} className="p-3 text-sm flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500">{new Date(po.created_at).toLocaleDateString("en-CA")}</p>
                  <p className="text-gray-700">{po.generated_reason}</p>
                  <p className="text-xs mt-1">
                    Estado: <span className="font-medium">{po.status}</span>
                  </p>
                </div>
                {po.status === "pending_approval" && (
                  <button
                    onClick={() => approvePO(po.id)}
                    disabled={poBusy}
                    className="flex items-center gap-1 bg-state-success text-white px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-50 flex-shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" /> Aprobar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
        ) : tab === "items" ? (
          <>
            <form onSubmit={addItem} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3 mb-4">
              <h2 className="text-sm font-semibold text-brand-ink">Agregar producto</h2>
              <input
                type="text" placeholder="Nombre (ej: Desengrasante)" value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                className="w-full text-sm border rounded-lg px-3 py-2"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={itemForm.category}
                  onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                >
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <input
                  type="text" placeholder="Unidad (L, unit, box)" value={itemForm.unit}
                  onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="number" placeholder="Stock actual" value={itemForm.currentStock}
                  onChange={(e) => setItemForm({ ...itemForm, currentStock: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="number" placeholder="Umbral de reposición" value={itemForm.reorderThreshold}
                  onChange={(e) => setItemForm({ ...itemForm, reorderThreshold: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
              </div>
              <button type="submit" disabled={saving} className="flex items-center gap-1 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                <Plus className="w-4 h-4" /> Agregar
              </button>
            </form>

            <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
              {items.length === 0 && <p className="p-4 text-sm text-gray-500">Sin productos todavía.</p>}
              {items.map((i) => (
                <div key={i.id} className="p-3 flex justify-between text-sm">
                  <span className="font-medium">{i.name}</span>
                  <span className="text-gray-500">{i.current_stock} {i.unit} (umbral {i.reorder_threshold})</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <form onSubmit={addSupplier} className="bg-white rounded-xl shadow-elevation-1 p-4 space-y-3 mb-4">
              <h2 className="text-sm font-semibold text-brand-ink">Agregar proveedor</h2>
              <input
                type="text" placeholder="Nombre del proveedor" value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                className="w-full text-sm border rounded-lg px-3 py-2"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text" placeholder="Contacto" value={supplierForm.contactName}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contactName: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="text" placeholder="Teléfono" value={supplierForm.contactPhone}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contactPhone: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="email" placeholder="Email" value={supplierForm.contactEmail}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contactEmail: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
                <input
                  type="number" placeholder="Días de entrega" value={supplierForm.leadTimeDays}
                  onChange={(e) => setSupplierForm({ ...supplierForm, leadTimeDays: e.target.value })}
                  className="text-sm border rounded-lg px-3 py-2"
                />
              </div>
              <button type="submit" disabled={saving} className="flex items-center gap-1 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                <Plus className="w-4 h-4" /> Agregar
              </button>
            </form>

            <div className="bg-white rounded-xl shadow-elevation-1 divide-y">
              {suppliers.length === 0 && <p className="p-4 text-sm text-gray-500">Sin proveedores todavía.</p>}
              {suppliers.map((s) => (
                <div key={s.id} className="p-3 text-sm">
                  <span className="font-medium">{s.name}</span>
                  {s.contact_name && <span className="text-gray-500"> — {s.contact_name}</span>}
                  {s.contact_phone && <span className="text-gray-500"> · {s.contact_phone}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
