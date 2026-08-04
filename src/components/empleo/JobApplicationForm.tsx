"use client";

import React, { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

// Los links a /privacidad viven DENTRO de un <label> asociado (vía htmlFor)
// al checkbox de consentimiento -- sin detener la propagación del click,
// activar el link también alterna el checkbox (comportamiento nativo de
// <label>). Mismo patrón que ConsentCheck.tsx (cotizador).
function stopLabelToggle(e: React.MouseEvent) {
  e.stopPropagation();
}

// Formulario público del Paso 1 del flujo de contratación ("empleo" en el
// sitio público). Llama a POST /api/hiring-flow/apply, que a su vez orquesta
// src/lib/hiring-flow/candidate-step1-service.ts (submitStep1Application) --
// ese servicio NO se toca desde aquí, solo se consume vía la API route.
//
// Validación en cliente: solo un chequeo básico (campos requeridos, formato
// de email) para dar feedback inmediato antes de golpear el servidor. La
// validación autoritativa vive en step1-validator.ts (server-side) -- si el
// servidor devuelve 400 con errores de validación por campo, se muestran
// tal cual (ver handleSubmit / fieldErrors abajo).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fix (auditoría externa 2026-08-02, hallazgo CRÍTICO #2): antes este
// formulario solo mostraba un string i18n hardcodeado
// (`empleo.fields.consentLabel`) como si fuera el consentimiento legal,
// sin enlazar al texto legal real ni a /privacidad, y sin que el backend
// supiera qué versión exacta se le mostró al candidato. Ahora se carga el
// texto legal ACTIVO real desde GET /api/hiring-flow/legal-text (key
// "pipa_step1", ver esa ruta y legal-text-service.ts) al montar el
// formulario, y se envía de vuelta `legalTextVersion` en el submit -- el
// backend (candidate-step1-service.ts) valida que siga siendo la versión
// activa vigente (ver LegalTextVersionMismatchError).
const PIPA_STEP1_KEY = "pipa_step1";

interface LegalTextState {
  version: string;
  text: string;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  consentAccepted: boolean;
}

const INITIAL_STATE: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  consentAccepted: false,
};

interface ValidationErrorItem {
  field: string;
  message: string;
}

export function JobApplicationForm() {
  const t = useTranslations("empleo");
  const locale = useLocale();
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [generalError, setGeneralError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [legalText, setLegalText] = useState<LegalTextState | null>(null);
  const [legalTextLoadFailed, setLegalTextLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadLegalText() {
      try {
        const response = await fetch(
          `/api/hiring-flow/legal-text?key=${encodeURIComponent(PIPA_STEP1_KEY)}`
        );
        if (!response.ok) {
          throw new Error(`Unexpected status ${response.status}`);
        }
        const data = (await response.json()) as { version: string; text: string };
        if (!cancelled) {
          setLegalText({ version: data.version, text: data.text });
        }
      } catch {
        if (!cancelled) {
          setLegalTextLoadFailed(true);
        }
      }
    }

    void loadLegalText();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadLegalText() {
    setLegalTextLoadFailed(false);
    setLegalText(null);
    try {
      const response = await fetch(
        `/api/hiring-flow/legal-text?key=${encodeURIComponent(PIPA_STEP1_KEY)}`
      );
      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }
      const data = (await response.json()) as { version: string; text: string };
      setLegalText({ version: data.version, text: data.text });
    } catch {
      setLegalTextLoadFailed(true);
    }
  }

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateClientSide(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (form.firstName.trim().length === 0) {
      errors.firstName = t("errors.required");
    }
    if (form.lastName.trim().length === 0) {
      errors.lastName = t("errors.required");
    }
    if (form.email.trim().length === 0) {
      errors.email = t("errors.required");
    } else if (!EMAIL_PATTERN.test(form.email.trim())) {
      errors.email = t("errors.invalidEmail");
    }
    if (form.phone.trim().length === 0) {
      errors.phone = t("errors.required");
    }
    if (form.dateOfBirth.trim().length === 0) {
      errors.dateOfBirth = t("errors.required");
    }
    if (!form.consentAccepted || !legalText) {
      errors.consentAccepted = t("errors.consentRequired");
    }
    return errors;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneralError("");

    const clientErrors = validateClientSide();
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});
    setLoading(true);

    try {
      const response = await fetch("/api/hiring-flow/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          dateOfBirth: form.dateOfBirth,
          consentAccepted: form.consentAccepted,
          legalTextVersion: legalText?.version,
          locale,
        }),
      });

      if (response.status === 200) {
        setSubmitted(true);
        return;
      }

      if (response.status === 400) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          validationErrors?: ValidationErrorItem[];
        } | null;

        if (data?.validationErrors && data.validationErrors.length > 0) {
          const mapped: Record<string, string> = {};
          for (const item of data.validationErrors) {
            mapped[item.field] = item.message;
          }
          setFieldErrors(mapped);
          setGeneralError(t("errors.validationFailed"));
        } else {
          setGeneralError(t("errors.consentRequired"));
        }
        return;
      }

      // Fix (auditoría externa, hallazgo MEDIO #4): el 409 ahora trae un
      // código estable en `error` (ver apply/route.ts) -- se distinguen
      // los dos casos posibles en vez de caer siempre en el mensaje
      // genérico, para que el candidato sepa qué pasó y qué hacer.
      if (response.status === 409) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        if (data?.error === "legal_text_outdated") {
          setGeneralError(t("errors.legalTextOutdated"));
          await reloadLegalText();
          updateField("consentAccepted", false);
        } else {
          // "duplicate_application" o cualquier otro código no reconocido
          // en este 409: el mensaje de duplicado sigue siendo el más
          // informativo y no revela nada sensible.
          setGeneralError(t("errors.duplicateApplication"));
        }
        return;
      }

      if (response.status === 503) {
        setGeneralError(t("errors.temporarilyUnavailable"));
        return;
      }

      // Nunca mostrar detalle crudo del servidor -- mismo criterio que
      // AuthModal.tsx (src/components/cotizador/AuthModal.tsx): siempre un
      // mensaje genérico localizado ante cualquier otro código de estado.
      setGeneralError(t("errors.genericFailed"));
    } catch {
      setGeneralError(t("errors.genericFailed"));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div
        role="status"
        className="bg-white rounded-lg shadow-elevation-1 p-6 sm:p-8 flex flex-col items-center text-center gap-4"
      >
        <CheckCircle2 className="w-12 h-12 text-state-success" />
        <h2 className="text-xl font-bold text-brand-ink">{t("successTitle")}</h2>
        <p className="text-gray-600">{t("successDesc")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="bg-white rounded-lg shadow-elevation-1 p-6 sm:p-8 space-y-5">
      {generalError && (
        <div role="alert" className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm">
          {generalError}
        </div>
      )}

      <div>
        <label htmlFor="empleo-first-name" className="block text-sm font-medium text-brand-ink mb-1">
          {t("fields.firstNameLabel")}
        </label>
        <input
          id="empleo-first-name"
          type="text"
          autoComplete="given-name"
          value={form.firstName}
          onChange={(e) => updateField("firstName", e.target.value)}
          aria-invalid={Boolean(fieldErrors.firstName)}
          aria-describedby={fieldErrors.firstName ? "empleo-first-name-error" : undefined}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
        />
        {fieldErrors.firstName && (
          <p id="empleo-first-name-error" className="text-xs text-state-danger mt-1">
            {fieldErrors.firstName}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="empleo-last-name" className="block text-sm font-medium text-brand-ink mb-1">
          {t("fields.lastNameLabel")}
        </label>
        <input
          id="empleo-last-name"
          type="text"
          autoComplete="family-name"
          value={form.lastName}
          onChange={(e) => updateField("lastName", e.target.value)}
          aria-invalid={Boolean(fieldErrors.lastName)}
          aria-describedby={fieldErrors.lastName ? "empleo-last-name-error" : undefined}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
        />
        {fieldErrors.lastName && (
          <p id="empleo-last-name-error" className="text-xs text-state-danger mt-1">
            {fieldErrors.lastName}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="empleo-email" className="block text-sm font-medium text-brand-ink mb-1">
          {t("fields.emailLabel")}
        </label>
        <input
          id="empleo-email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => updateField("email", e.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "empleo-email-error" : undefined}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
        />
        {fieldErrors.email && (
          <p id="empleo-email-error" className="text-xs text-state-danger mt-1">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="empleo-phone" className="block text-sm font-medium text-brand-ink mb-1">
          {t("fields.phoneLabel")}
        </label>
        <input
          id="empleo-phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => updateField("phone", e.target.value)}
          placeholder="6041234567"
          aria-invalid={Boolean(fieldErrors.phone)}
          aria-describedby={fieldErrors.phone ? "empleo-phone-error" : undefined}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
        />
        {fieldErrors.phone && (
          <p id="empleo-phone-error" className="text-xs text-state-danger mt-1">
            {fieldErrors.phone}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="empleo-dob" className="block text-sm font-medium text-brand-ink mb-1">
          {t("fields.dateOfBirthLabel")}
        </label>
        <input
          id="empleo-dob"
          type="date"
          autoComplete="bday"
          value={form.dateOfBirth}
          onChange={(e) => updateField("dateOfBirth", e.target.value)}
          aria-invalid={Boolean(fieldErrors.dateOfBirth)}
          aria-describedby={fieldErrors.dateOfBirth ? "empleo-dob-error" : undefined}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
        />
        {fieldErrors.dateOfBirth && (
          <p id="empleo-dob-error" className="text-xs text-state-danger mt-1">
            {fieldErrors.dateOfBirth}
          </p>
        )}
      </div>

      <div>
        {!legalText && !legalTextLoadFailed && (
          <div className="flex items-center gap-2 text-sm text-gray-500 p-3 rounded-lg border border-gray-200 bg-gray-50">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            {t("legalText.loading")}
          </div>
        )}

        {legalTextLoadFailed && (
          <div className="flex items-start gap-2 text-sm text-state-danger p-3 rounded-lg border border-state-danger/30 bg-state-danger/10">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{t("legalText.loadError")}</p>
              <button
                type="button"
                onClick={() => void reloadLegalText()}
                className="mt-2 underline font-medium hover:text-state-danger/80"
              >
                {t("legalText.retry")}
              </button>
            </div>
          </div>
        )}

        {legalText && (
          <div
            className="max-h-32 overflow-y-auto text-xs text-gray-600 p-3 rounded-lg border border-gray-200 bg-gray-50 whitespace-pre-wrap"
            aria-label={t("legalText.textAriaLabel")}
          >
            {legalText.text}
          </div>
        )}
      </div>

      <div className="flex items-start gap-3">
        <input
          id="empleo-consent"
          type="checkbox"
          checked={form.consentAccepted}
          onChange={(e) => updateField("consentAccepted", e.target.checked)}
          disabled={!legalText}
          aria-invalid={Boolean(fieldErrors.consentAccepted)}
          aria-describedby={fieldErrors.consentAccepted ? "empleo-consent-error" : undefined}
          className="mt-1 w-4 h-4 rounded border-gray-300 text-brand-navy focus:ring-brand-wave-blue disabled:opacity-50"
        />
        <label htmlFor="empleo-consent" className="text-sm text-gray-600">
          {t.rich("fields.consentLabel", {
            link: (chunks) => (
              <a
                href={`/${locale}/privacy`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={stopLabelToggle}
                className="underline hover:text-brand-navy"
              >
                {chunks}
              </a>
            ),
          })}
        </label>
      </div>
      {fieldErrors.consentAccepted && (
        <p id="empleo-consent-error" className="text-xs text-state-danger -mt-3">
          {fieldErrors.consentAccepted}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !legalText}
        aria-label={t("submitAriaLabel")}
        className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("submitting")}
          </>
        ) : (
          t("submit")
        )}
      </button>
    </form>
  );
}
