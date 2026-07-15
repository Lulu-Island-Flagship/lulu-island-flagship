"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Handshake, Plus, X, Calculator } from "lucide-react";

type PartnerType = "real_estate_agent" | "property_manager" | "veterinarian" | "builder";

interface Partner {
  id: string;
  partner_type: PartnerType;
  name: string;
  contact_email: string | null;
  is_active: boolean;
}

interface Commission {
  id: string;
  amount_cents: number;
  description: string;
  status: "pending" | "paid" | "void";
  created_at: string;
  partners: { name: string; partner_type: PartnerType } | null;
}

const TYPE_LABEL: Record<PartnerType, string> = {
  real_estate_agent: "Real Estate Agent (10% first booking)",
  property_manager: "Property Manager (5% monthly)",
  veterinarian: "Veterinarian ($20 flat)",
  builder: "Builder (15%)",
};

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [showCalcForm, setShowCalcForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ partnerType: "real_estate_agent" as PartnerType, name: "", contactEmail: "" });
  const [calcForm, setCalcForm] = useState({ partnerId: "", orderId: "", orderValueDollars: "" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [pRes, cRes] = await Promise.all([
        fetch("/api/admin/partners", { credentials: "include" }),
        fetch("/api/admin/partner-commissions", { credentials: "include" }),
      ]);
      if (pRes.ok) setPartners((await pRes.json()).partners || []);
      if (cRes.ok) setCommissions((await cRes.json()).partnerCommissions || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function submitPartner(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          partnerType: partnerForm.partnerType,
          name: partnerForm.name.trim(),
          contactEmail: partnerForm.contactEmail.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed");
        return;
      }
      setShowPartnerForm(false);
      setPartnerForm({ partnerType: "real_estate_agent", name: "", contactEmail: "" });
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function submitCalc(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/partner-commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "calculate",
          partnerId: calcForm.partnerId,
          orderId: calcForm.orderId.trim(),
          orderValueCents: Math.round(Number(calcForm.orderValueDollars) * 100),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed");
        return;
      }
      setShowCalcForm(false);
      setCalcForm({ partnerId: "", orderId: "", orderValueDollars: "" });
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function markPaid(id: string) {
    await fetch("/api/admin/partner-commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "mark_paid", id }),
    });
    await load();
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-ink">Partners & Commissions</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCalcForm(true)} className="inline-flex items-center gap-1.5 text-sm text-brand-navy hover:underline">
            <Calculator className="w-4 h-4" /> Calculate Commission
          </button>
          <button
            onClick={() => setShowPartnerForm(true)}
            className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Register Partner
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {showPartnerForm && (
        <form onSubmit={submitPartner} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">New Partner</h2>
            <button type="button" onClick={() => setShowPartnerForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
          </div>
          <select
            value={partnerForm.partnerType}
            onChange={(e) => setPartnerForm((f) => ({ ...f, partnerType: e.target.value as PartnerType }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <input type="text" placeholder="Name" value={partnerForm.name} onChange={(e) => setPartnerForm((f) => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <input type="email" placeholder="Contact email (optional)" value={partnerForm.contactEmail} onChange={(e) => setPartnerForm((f) => ({ ...f, contactEmail: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" />
          <button type="submit" disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
      )}

      {showCalcForm && (
        <form onSubmit={submitCalc} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">Calculate Commission</h2>
            <button type="button" onClick={() => setShowCalcForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
          </div>
          <select value={calcForm.partnerId} onChange={(e) => setCalcForm((f) => ({ ...f, partnerId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required>
            <option value="" disabled>Select partner</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {TYPE_LABEL[p.partner_type]}</option>
            ))}
          </select>
          <input type="text" placeholder="Order ID" value={calcForm.orderId} onChange={(e) => setCalcForm((f) => ({ ...f, orderId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <input type="number" min={0} step="0.01" placeholder="Order value ($)" value={calcForm.orderValueDollars} onChange={(e) => setCalcForm((f) => ({ ...f, orderValueDollars: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <button type="submit" disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? "Calculating..." : "Calculate & Log"}
          </button>
        </form>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">Partners ({partners.length})</h2>
        <div className="bg-white rounded-xl border divide-y">
          {partners.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              <Handshake className="w-8 h-8 text-gray-300 mx-auto mb-2" /> No partners registered yet.
            </div>
          ) : (
            partners.map((p) => (
              <div key={p.id} className="p-3 flex items-center justify-between text-sm">
                <span className="text-brand-ink font-medium">{p.name}</span>
                <span className="text-xs text-gray-500">{TYPE_LABEL[p.partner_type]}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">Commissions</h2>
        <div className="bg-white rounded-xl border divide-y">
          {commissions.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No commissions logged yet.</div>
          ) : (
            commissions.map((c) => (
              <div key={c.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="text-brand-ink font-medium">{c.partners?.name} — {money(c.amount_cents)}</p>
                  <p className="text-xs text-gray-500">{c.description}</p>
                </div>
                {c.status === "pending" ? (
                  <button onClick={() => markPaid(c.id)} className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-lg">
                    Mark Paid
                  </button>
                ) : (
                  <span className="text-xs text-state-success">{c.status}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
