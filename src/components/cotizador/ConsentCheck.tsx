"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FileText, Camera, Mail, Check } from "lucide-react";
import { CONSENT_VERSIONS } from "@/lib/pricing";

interface ConsentCheckProps {
  consents: {
    tc: boolean;
    pipa: boolean;
    marketing: boolean;
    photoMarketing: boolean;
  };
  onChange: (consents: {
    tc: boolean;
    pipa: boolean;
    marketing: boolean;
    photoMarketing: boolean;
  }) => void;
}

export function ConsentCheck({ consents, onChange }: ConsentCheckProps) {
  const t = useTranslations("cotizador.consentCheck");
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-brand-ink">{t("title")}</h3>

      {/* Terms & Conditions */}
      <label htmlFor="consent-tc" className="flex items-start gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-brand-wave-blue cursor-pointer transition-all">
        <input
          id="consent-tc"
          type="checkbox"
          checked={consents.tc}
          onChange={(e) => onChange({ ...consents, tc: e.target.checked })}
          className="mt-1 w-5 h-5 accent-brand-gold"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-brand-wave-blue" />
            <span className="font-medium text-sm">{t("tcLabel")}</span>
            <span className="text-xs text-gray-400">v{CONSENT_VERSIONS.tc}</span>
            {consents.tc && <Check className="w-4 h-4 text-state-success" />}
          </div>
          <p className="text-xs text-gray-500">
            {t("tcDesc")}
          </p>
        </div>
      </label>

      {/* PIPA - Photo Evidence */}
      <label htmlFor="consent-pipa" className="flex items-start gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-brand-wave-blue cursor-pointer transition-all">
        <input
          id="consent-pipa"
          type="checkbox"
          checked={consents.pipa}
          onChange={(e) => onChange({ ...consents, pipa: e.target.checked })}
          className="mt-1 w-5 h-5 accent-brand-gold"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Camera className="w-4 h-4 text-brand-wave-blue" />
            <span className="font-medium text-sm">{t("pipaLabel")}</span>
            <span className="text-xs text-gray-400">v{CONSENT_VERSIONS.pipa}</span>
            {consents.pipa && <Check className="w-4 h-4 text-state-success" />}
          </div>
          <p className="text-xs text-gray-500">
            {t("pipaDesc")}
          </p>
          {!consents.pipa && (
            <p className="text-xs text-state-warning mt-2">
              {t("pipaWarning")}
            </p>
          )}
        </div>
      </label>

      {/* Marketing - CASL */}
      <label htmlFor="consent-marketing" className="flex items-start gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-brand-wave-blue cursor-pointer transition-all">
        <input
          id="consent-marketing"
          type="checkbox"
          checked={consents.marketing}
          onChange={(e) => onChange({ ...consents, marketing: e.target.checked })}
          className="mt-1 w-5 h-5 accent-brand-gold"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-brand-wave-blue" />
            <span className="font-medium text-sm">{t("marketingLabel")}</span>
            <span className="text-xs text-gray-400">v{CONSENT_VERSIONS.marketing}</span>
            {consents.marketing && <Check className="w-4 h-4 text-state-success" />}
          </div>
          <p className="text-xs text-gray-500">
            {t("marketingDesc")}
          </p>
        </div>
      </label>

      {/* Photo Marketing */}
      <label htmlFor="consent-photo-marketing" className="flex items-start gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-brand-wave-blue cursor-pointer transition-all">
        <input
          id="consent-photo-marketing"
          type="checkbox"
          checked={consents.photoMarketing}
          onChange={(e) => onChange({ ...consents, photoMarketing: e.target.checked })}
          className="mt-1 w-5 h-5 accent-brand-gold"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Camera className="w-4 h-4 text-brand-wave-blue" />
            <span className="font-medium text-sm">{t("photoMarketingLabel")}</span>
            <span className="text-xs text-gray-400">v{CONSENT_VERSIONS.photoMarketing}</span>
            {consents.photoMarketing && <Check className="w-4 h-4 text-state-success" />}
          </div>
          <p className="text-xs text-gray-500">
            {t("photoMarketingDesc")}
          </p>
        </div>
      </label>
    </div>
  );
}
