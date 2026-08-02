"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Loader2, Handshake, Plus, X, Calculator } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

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

export default function PartnersPage() {
  const t = useTranslations("admin.partners");
  const params = useParams();
  // Fix (auditoría 2026-07-30, item 2): antes se concatenaba "$" a mano
  // (`$${(cents / 100).toFixed(2)}`), sin usar Intl.NumberFormat -- rompía
  // localización real (separadores, posición del símbolo) para fr/zh. Se usa
  // el mismo helper formatCurrency() ya centralizado en src/lib/format.ts.
  const locale = (params?.locale as string) || "en";
  const money = (cents: number) => formatCurrency(cents / 100, locale);
  const TYPE_LABEL: Record<PartnerType, string> = {
    real_estate_agent: t("type.realEstateAgent"),
    property_manager: t("type.propertyManager"),
    veterinarian: t("type.veterinarian"),
    builder: t("type.builder"),
  };
  const [partners, setPartners] = useState<Partner[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [showCalcForm, setShowCalcForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ partnerType: "real_estate_agent" as PartnerType, name: "", contactEmail: "" });
  const [calcForm, setCalcForm] = useState({ partnerId: "", orderId: "", orderValueDollars: "" });
  // Fix (auditoría externa 2026-07-31, item 12): markPaid no pedía
  // confirmación ni manejaba errores del servidor -- un click accidental
  // marcaba una comisión real como pagada, y si el fetch fallaba, la UI no
  // decía nada (parecía haber funcionado).
  const [confirmPayCommission, setConfirmPayCommission] = useState<Commission | null>(null);

  const load = useCallback(async () => {
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
      setError(t("errorNetwork"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
        setError(err.error || t("errorGeneric"));
        return;
      }
      setShowPartnerForm(false);
      setPartnerForm({ partnerType: "real_estate_agent", name: "", contactEmail: "" });
      await load();
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setSaving(false);
    }
  }

  async function submitCalc(e: React.FormEvent) {
    e.preventDefault();
    const orderValue = Number(calcForm.orderValueDollars);
    if (!Number.isFinite(orderValue) || orderValue <= 0) {
      setError(t("invalidOrderValue"));
      return;
    }
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
          orderValueCents: Math.round(orderValue * 100),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errorGeneric"));
        return;
      }
      setShowCalcForm(false);
      setCalcForm({ partnerId: "", orderId: "", orderValueDollars: "" });
      await load();
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setSaving(false);
    }
  }

  async function markPaid(id: string) {
    const res = await fetch("/api/admin/partner-commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "mark_paid", id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || t("errorGeneric"));
    }
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
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCalcForm(true)} className="inline-flex items-center gap-1.5 text-sm text-brand-navy hover:underline">
            <Calculator className="w-4 h-4" /> {t("calculateCommission")}
          </button>
          <button
            onClick={() => setShowPartnerForm(true)}
            className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> {t("registerPartner")}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {showPartnerForm && (
        <form onSubmit={submitPartner} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">{t("newPartner")}</h2>
            <button type="button" onClick={() => setShowPartnerForm(false)} aria-label={t("closeForm")}><X className="w-5 h-5 text-gray-400" aria-hidden="true" /></button>
          </div>
          <select
            aria-label={t("partnerType")}
            value={partnerForm.partnerType}
            onChange={(e) => setPartnerForm((f) => ({ ...f, partnerType: e.target.value as PartnerType }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <input type="text" aria-label={t("partnerName")} placeholder={t("name")} value={partnerForm.name} onChange={(e) => setPartnerForm((f) => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <input type="email" aria-label={t("partnerContactEmailOptional")} placeholder={t("contactEmailOptional")} value={partnerForm.contactEmail} onChange={(e) => setPartnerForm((f) => ({ ...f, contactEmail: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" />
          <button type="submit" aria-label={t("savePartner")} disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? t("saving") : t("save")}
          </button>
        </form>
      )}

      {showCalcForm && (
        <form onSubmit={submitCalc} className="bg-white rounded-xl border p-4 space-y-3 max-w-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-ink">{t("calculateCommission")}</h2>
            <button type="button" onClick={() => setShowCalcForm(false)} aria-label={t("closeForm")}><X className="w-5 h-5 text-gray-400" aria-hidden="true" /></button>
          </div>
          <select aria-label={t("selectPartner")} value={calcForm.partnerId} onChange={(e) => setCalcForm((f) => ({ ...f, partnerId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required>
            <option value="" disabled>{t("selectPartnerOption")}</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {TYPE_LABEL[p.partner_type]}</option>
            ))}
          </select>
          <input type="text" aria-label={t("orderId")} placeholder={t("orderId")} value={calcForm.orderId} onChange={(e) => setCalcForm((f) => ({ ...f, orderId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <input type="number" aria-label={t("orderValueDollars")} min={0} step="0.01" placeholder={t("orderValuePlaceholder")} value={calcForm.orderValueDollars} onChange={(e) => setCalcForm((f) => ({ ...f, orderValueDollars: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" required />
          <button type="submit" aria-label={t("calculateAndLog")} disabled={saving} className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? t("calculating") : t("calculateAndLogShort")}
          </button>
        </form>
      )}

      <div>
        <h2 className="font-semibold text-brand-ink mb-2">{t("partnersCount", { count: partners.length })}</h2>
        <div className="bg-white rounded-xl border divide-y">
          {partners.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              <Handshake className="w-8 h-8 text-gray-300 mx-auto mb-2" /> {t("noPartners")}
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
        <h2 className="font-semibold text-brand-ink mb-2">{t("commissions")}</h2>
        <div className="bg-white rounded-xl border divide-y">
          {commissions.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">{t("noCommissions")}</div>
          ) : (
            commissions.map((c) => (
              <div key={c.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="text-brand-ink font-medium">{c.partners?.name} — {money(c.amount_cents)}</p>
                  <p className="text-xs text-gray-500">{c.description}</p>
                </div>
                {c.status === "pending" ? (
                  <button onClick={() => setConfirmPayCommission(c)} className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-lg">
                    {t("markPaid")}
                  </button>
                ) : (
                  <span className="text-xs text-state-success">{t(`commissionStatus.${c.status}`)}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {confirmPayCommission && (
        <ConfirmActionModal
          title={t("confirmMarkPaid.title")}
          message={t("confirmMarkPaid.message", {
            partner: confirmPayCommission.partners?.name || "",
            amount: money(confirmPayCommission.amount_cents),
          })}
          confirmLabel={t("markPaid")}
          onCancel={() => setConfirmPayCommission(null)}
          onConfirm={async () => {
            await markPaid(confirmPayCommission.id);
            setConfirmPayCommission(null);
          }}
        />
      )}
    </div>
  );
}
