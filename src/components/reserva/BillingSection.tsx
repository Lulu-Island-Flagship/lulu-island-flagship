"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { QuoteData } from "@/types";
import { Receipt } from "lucide-react";

interface BillingSectionProps {
  quote: QuoteData;
  accountType: "b2c" | "b2b" | "government";
  initialName?: string;
  initialBillingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    province: string;
    postalCode: string;
  };
  initialGstNumber?: string;
  initialRecipientName?: string;
  onChange: (data: {
    billingPartyName: string;
    billingAddressLine1: string;
    billingAddressLine2: string;
    billingCity: string;
    billingProvince: string;
    billingPostalCode: string;
    gstNumber: string;
    serviceRecipientName: string;
  }) => void;
}

export function BillingSection({
  quote,
  accountType,
  initialName = "",
  initialBillingAddress,
  initialGstNumber = "",
  initialRecipientName = "",
  onChange,
}: BillingSectionProps) {
  const t = useTranslations("reserva.billing");
  const isB2B = accountType === "b2b" || accountType === "government";

  const [sameAsService, setSameAsService] = useState(true);
  const [name, setName] = useState(initialName);
  const [billingLine1, setBillingLine1] = useState(
    sameAsService ? quote.address : (initialBillingAddress?.line1 ?? "")
  );
  const [billingLine2, setBillingLine2] = useState(initialBillingAddress?.line2 ?? "");
  const [billingCity, setBillingCity] = useState(initialBillingAddress?.city ?? "");
  const [billingProvince, setBillingProvince] = useState(initialBillingAddress?.province ?? "BC");
  const [billingPostal, setBillingPostal] = useState(
    sameAsService ? (quote.postalCode ?? "") : (initialBillingAddress?.postalCode ?? "")
  );
  const [gstNumber, setGstNumber] = useState(initialGstNumber);
  const [recipientName, setRecipientName] = useState(initialRecipientName);

  const emit = () => {
    onChange({
      billingPartyName: name,
      billingAddressLine1: sameAsService ? quote.address : billingLine1,
      billingAddressLine2: billingLine2,
      billingCity: sameAsService ? "" : billingCity,
      billingProvince: sameAsService ? "BC" : billingProvince,
      billingPostalCode: sameAsService ? (quote.postalCode ?? "") : billingPostal,
      gstNumber,
      serviceRecipientName: recipientName,
    });
  };

  const handleSameAsService = (checked: boolean) => {
    setSameAsService(checked);
    if (checked) {
      setBillingLine1(quote.address);
      setBillingPostal(quote.postalCode ?? "");
    }
    // Emit after state settles — caller reads from state
    setTimeout(() => {
      onChange({
        billingPartyName: name,
        billingAddressLine1: checked ? quote.address : billingLine1,
        billingAddressLine2: billingLine2,
        billingCity: checked ? "" : billingCity,
        billingProvince: checked ? "BC" : billingProvince,
        billingPostalCode: checked ? (quote.postalCode ?? "") : billingPostal,
        gstNumber,
        serviceRecipientName: recipientName,
      });
    }, 0);
  };

  return (
    <div className="bg-white rounded-lg shadow-elevation-1 p-6">
      <h2 className="text-lg font-semibold text-brand-ink mb-4 flex items-center gap-2">
        <Receipt className="w-5 h-5 text-brand-gold" />
        {t("title")}
      </h2>

      <div className="space-y-3">
        {/* Name */}
        <div>
          <label htmlFor="billing-name" className="block text-sm font-medium text-gray-700 mb-1">
            {t("nameLabel")}
          </label>
          <input
            id="billing-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            onBlur={emit}
            placeholder={t("namePlaceholder")}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
          />
        </div>

        {/* Same as service checkbox */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={sameAsService}
            onChange={(e) => handleSameAsService(e.target.checked)}
            className="w-4 h-4 accent-brand-gold"
          />
          {t("sameAsService")}
        </label>

        {/* Billing address (when different) */}
        {!sameAsService && (
          <div className="space-y-2 pl-2 border-l-2 border-brand-gold/30">
            <p className="text-xs font-medium text-gray-500">{t("billingAddressLabel")}</p>
            <input
              type="text"
              value={billingLine1}
              onChange={(e) => setBillingLine1(e.target.value)}
              onBlur={emit}
              placeholder={t("billingAddressPlaceholder")}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
            />
            <input
              type="text"
              value={billingLine2}
              onChange={(e) => setBillingLine2(e.target.value)}
              onBlur={emit}
              placeholder="Apt / Suite / Unit"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={billingCity}
                onChange={(e) => setBillingCity(e.target.value)}
                onBlur={emit}
                placeholder={t("billingCityPlaceholder")}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
              />
              <input
                type="text"
                value={billingProvince}
                onChange={(e) => setBillingProvince(e.target.value)}
                onBlur={emit}
                placeholder={t("billingProvincePlaceholder")}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
              />
            </div>
            <input
              type="text"
              value={billingPostal}
              onChange={(e) => setBillingPostal(e.target.value)}
              onBlur={emit}
              placeholder={t("billingPostalPlaceholder")}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
            />
          </div>
        )}

        {/* GST (B2B only) */}
        {isB2B && (
          <div>
            <label htmlFor="billing-gst" className="block text-sm font-medium text-gray-700 mb-1">
              {t("gstLabel")}
            </label>
            <input
              id="billing-gst"
              type="text"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
              onBlur={emit}
              placeholder={t("gstPlaceholder")}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
            />
          </div>
        )}

        {/* Service recipient (if different) */}
        {isB2B && (
          <div>
            <label htmlFor="billing-recipient" className="block text-sm font-medium text-gray-700 mb-1">
              {t("recipientNameLabel")}
            </label>
            <input
              id="billing-recipient"
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              onBlur={emit}
              placeholder={t("recipientNamePlaceholder")}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}
