"use client";

import React from "react";
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
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-brand-ink">Consent & Agreements</h3>

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
            <span className="font-medium text-sm">Terms & Conditions</span>
            <span className="text-xs text-gray-400">v{CONSENT_VERSIONS.tc}</span>
            {consents.tc && <Check className="w-4 h-4 text-state-success" />}
          </div>
          <p className="text-xs text-gray-500">
            I agree to the Terms of Service, including the cancellation policy,
            payment terms, and service scope. Required to proceed.
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
            <span className="font-medium text-sm">Photo Evidence Consent (PIPA) — Optional</span>
            <span className="text-xs text-gray-400">v{CONSENT_VERSIONS.pipa}</span>
            {consents.pipa && <Check className="w-4 h-4 text-state-success" />}
          </div>
          <p className="text-xs text-gray-500">
            I consent to the collection of photographic evidence of the cleaning
            service for quality assurance and dispute resolution, in accordance
            with BC&apos;s Personal Information Protection Act (PIPA).
          </p>
          {!consents.pipa && (
            <p className="text-xs text-state-warning mt-2">
              Without photo consent, your service will require a mandatory 100% field audit
              (no extra charge) and the checklist will be completed without photographs.
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
            <span className="font-medium text-sm">Marketing Communications (Optional)</span>
            <span className="text-xs text-gray-400">v{CONSENT_VERSIONS.marketing}</span>
            {consents.marketing && <Check className="w-4 h-4 text-state-success" />}
          </div>
          <p className="text-xs text-gray-500">
            I consent to receive promotional emails and SMS about special offers,
            seasonal cleaning tips, and service reminders. You can unsubscribe at
            any time. (CASL compliant)
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
            <span className="font-medium text-sm">Marketing Photos (Optional)</span>
            <span className="text-xs text-gray-400">v{CONSENT_VERSIONS.photoMarketing}</span>
            {consents.photoMarketing && <Check className="w-4 h-4 text-state-success" />}
          </div>
          <p className="text-xs text-gray-500">
            I consent to allowing Lulu Island Flagship to use before/after photos
            of my service for marketing purposes (website, social media, portfolio).
            Without this consent, only anonymous demo property photos will be used.
          </p>
        </div>
      </label>
    </div>
  );
}
