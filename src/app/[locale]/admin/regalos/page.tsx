"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Gift, CheckCircle2, Building2 } from "lucide-react";

interface RetentionGift {
  id: string;
  client_user_id: string;
  months_active: number;
  tier: string;
  suggested_gift_cents: number;
  requires_manual_approval: boolean;
  approved_at: string | null;
  delivered_at: string | null;
}

interface Partner {
  id: string;
  partner_type: string;
  name: string;
}

interface BuildingBenefit {
  id: string;
  partner_id: string;
  description: string;
  delivered_at: string | null;
  partners: { name: string } | { name: string }[] | null;
}

/**
 * v8.3 E9.11 — Programa de regalos: residencial (tiers por valor del primer
 * año, aprobación manual si el regalo supera el LTV) y property managers
 * (SOLO vía (a) beneficio transparente al edificio aquí -- la vía (b)
 * comisión declarada vive en Partners & Commissions, ya construido).
 * El backend ya existía; esta página cierra el gap de que nadie podía
 * aprobar/entregar los regalos ni registrar beneficios a edificios.
 */
export default function GiftsPage() {
  const t = useTranslations("admin.regalos");
  const [gifts, setGifts] = useState<RetentionGift[]>([]);
  const [benefits, setBenefits] = useState<BuildingBenefit[]>([]);
  const [pmPartners, setPmPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newGift, setNewGift] = useState({ clientUserId: "", monthsActive: "", firstYearValue: "", ltv: "" });
  const [newBenefit, setNewBenefit] = useState({ partnerId: "", description: "" });

  const monthsActiveNum = Number(newGift.monthsActive);
  const firstYearValueNum = parseFloat(newGift.firstYearValue);
  const ltvNum = newGift.ltv ? parseFloat(newGift.ltv) : 0;
  const giftFormValid =
    newGift.clientUserId.trim().length > 0 &&
    Number.isFinite(monthsActiveNum) &&
    monthsActiveNum >= 0 &&
    Number.isFinite(firstYearValueNum) &&
    firstYearValueNum > 0 &&
    Number.isFinite(ltvNum) &&
    ltvNum >= 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [giftsRes, benefitsRes, partnersRes] = await Promise.all([
        fetch("/api/admin/retention-gifts", { credentials: "include" }),
        fetch("/api/admin/retention-gifts/building-benefits", { credentials: "include" }),
        fetch("/api/admin/partners", { credentials: "include" }),
      ]);
      const giftsData = await giftsRes.json();
      const benefitsData = await benefitsRes.json();
      const partnersData = await partnersRes.json();
      if (giftsRes.ok) setGifts(giftsData.gifts || []);
      if (benefitsRes.ok) setBenefits(benefitsData.benefits || []);
      if (partnersRes.ok) {
        setPmPartners((partnersData.partners || []).filter((p: Partner) => p.partner_type === "property_manager"));
      }
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function createGift() {
    if (!giftFormValid) {
      setError(t("errors.invalidGiftInput"));
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/admin/retention-gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientUserId: newGift.clientUserId.trim(),
          monthsActive: monthsActiveNum,
          firstYearValueCents: Math.round(firstYearValueNum * 100),
          ltvCents: Math.round(ltvNum * 100),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("errors.failed"));
        return;
      }
      if (data.eligible === false) {
        setError(data.reason);
        return;
      }
      setNewGift({ clientUserId: "", monthsActive: "", firstYearValue: "", ltv: "" });
      await load();
    } catch {
      setError(t("errors.network"));
    }
  }

  async function actGift(id: string, action: "approve" | "deliver") {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/retention-gifts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("errors.failed"));
        return;
      }
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusyId(null);
    }
  }

  async function createBenefit() {
    if (!newBenefit.partnerId || !newBenefit.description.trim()) return;
    setError("");
    try {
      const res = await fetch("/api/admin/retention-gifts/building-benefits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(newBenefit),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("errors.failed"));
        return;
      }
      setNewBenefit({ partnerId: "", description: "" });
      await load();
    } catch {
      setError(t("errors.network"));
    }
  }

  async function deliverBenefit(id: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/retention-gifts/building-benefits/${id}`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("errors.failed"));
        return;
      }
      await load();
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink flex items-center gap-2">
          <Gift className="w-6 h-6" /> {t("title")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="space-y-3">
        <h2 className="font-semibold text-brand-ink">{t("residentialGifts.heading")}</h2>
        <div className="bg-white rounded-xl border p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input
            aria-label={t("residentialGifts.clientUserIdAria")}
            placeholder={t("residentialGifts.clientUserIdPlaceholder")}
            value={newGift.clientUserId}
            onChange={(e) => setNewGift({ ...newGift, clientUserId: e.target.value })}
            className="col-span-2 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            aria-label={t("residentialGifts.monthsActiveAria")}
            type="number"
            placeholder={t("residentialGifts.monthsActivePlaceholder")}
            value={newGift.monthsActive}
            onChange={(e) => setNewGift({ ...newGift, monthsActive: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            aria-label={t("residentialGifts.firstYearValueAria")}
            type="number"
            placeholder={t("residentialGifts.firstYearValuePlaceholder")}
            value={newGift.firstYearValue}
            onChange={(e) => setNewGift({ ...newGift, firstYearValue: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            aria-label={t("residentialGifts.ltvAria")}
            type="number"
            placeholder={t("residentialGifts.ltvPlaceholder")}
            value={newGift.ltv}
            onChange={(e) => setNewGift({ ...newGift, ltv: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={createGift}
            disabled={!giftFormValid}
            className="col-span-2 sm:col-span-1 bg-brand-navy text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {t("residentialGifts.evaluate")}
          </button>
        </div>

        {gifts.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">{t("residentialGifts.emptyState")}</div>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {gifts.map((g) => (
              <div key={g.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-brand-ink">
                    {g.tier} — ${(g.suggested_gift_cents / 100).toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t("residentialGifts.monthsActiveCount", { count: g.months_active })}
                    {g.requires_manual_approval && !g.approved_at && ` · ${t("residentialGifts.needsApproval")}`}
                    {g.approved_at && ` · ${t("residentialGifts.approvedLabel")}`}
                    {g.delivered_at && ` · ${t("residentialGifts.deliveredLabel")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {g.requires_manual_approval && !g.approved_at && (
                    <button
                      onClick={() => actGift(g.id, "approve")}
                      disabled={busyId === g.id}
                      className="text-xs font-medium bg-brand-navy text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      {t("residentialGifts.approve")}
                    </button>
                  )}
                  {!g.delivered_at && (!g.requires_manual_approval || g.approved_at) && (
                    <button
                      onClick={() => actGift(g.id, "deliver")}
                      disabled={busyId === g.id}
                      className="text-xs font-medium bg-state-success text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      {t("residentialGifts.markDelivered")}
                    </button>
                  )}
                  {g.delivered_at && <CheckCircle2 className="w-4 h-4 text-state-success" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-brand-ink flex items-center gap-2">
          <Building2 className="w-4 h-4" /> {t("buildingBenefits.heading")}
        </h2>
        <div className="bg-white rounded-xl border p-4 space-y-2">
          <select
            aria-label={t("buildingBenefits.selectPartnerAria")}
            value={newBenefit.partnerId}
            onChange={(e) => setNewBenefit({ ...newBenefit, partnerId: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">{t("buildingBenefits.selectPartnerOption")}</option>
            {pmPartners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            aria-label={t("buildingBenefits.descriptionAria")}
            value={newBenefit.description}
            onChange={(e) => setNewBenefit({ ...newBenefit, description: e.target.value })}
            placeholder={t("buildingBenefits.descriptionPlaceholder")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button onClick={createBenefit} className="w-full bg-brand-navy text-white py-2 rounded-lg text-sm font-medium">
            {t("buildingBenefits.logBenefit")}
          </button>
        </div>

        {benefits.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">{t("buildingBenefits.emptyState")}</div>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {benefits.map((b) => {
              const partner = Array.isArray(b.partners) ? b.partners[0] : b.partners;
              return (
                <div key={b.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-brand-ink">{partner?.name || t("buildingBenefits.unknownPartner")}</p>
                    <p className="text-xs text-gray-500">{b.description}</p>
                  </div>
                  {b.delivered_at ? (
                    <CheckCircle2 className="w-4 h-4 text-state-success" />
                  ) : (
                    <button
                      onClick={() => deliverBenefit(b.id)}
                      disabled={busyId === b.id}
                      className="text-xs font-medium bg-state-success text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      {t("buildingBenefits.markDelivered")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
