"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { Globe, Apple, Mail, Smartphone, X } from "lucide-react";

// Fix (auditoría externa 2026-07-24, accesibilidad): validación de email
// débil (`!email.includes("@")` dejaba pasar "a@b" o "@@@"). Regex simple
// de formato -- no pretende cubrir RFC 5322 completo, solo atrapar los
// casos obvios que la auditoría señaló.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
  // v8.3 fix (auditoría 2026-07-15): permite mostrar un error de OAuth
  // devuelto por /auth/callback (antes se perdía silenciosamente).
  initialError?: string;
  // v8.3 fix (auditoría E1 2026-07-18): un cliente que entra por Google/Apple
  // nunca pasaba por verificación telefónica (client_profiles.phone_verified
  // se quedaba en false para siempre -- SMS de recordatorio, aviso de llegada
  // del equipo, etc. dependen de un teléfono verificado). Cuando esta prop es
  // true, el modal se abre DIRECTO en el paso de verificación de teléfono
  // (sin "X" para saltarlo) y usa el flujo de vinculación de teléfono a la
  // cuenta YA autenticada (updateUser + verifyOtp type "phone_change"), no
  // un signInWithOtp nuevo (eso crearía una identidad separada).
  forcePhoneVerification?: boolean;
}

export function AuthModal({ onClose, onSuccess, initialError, forcePhoneVerification }: AuthModalProps) {
  const t = useTranslations("cotizador.authModal");
  const [mode, setMode] = useState<"options" | "email" | "phone" | "verify_phone">(
    forcePhoneVerification ? "verify_phone" : "options"
  );
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  // Fix (auditoría externa 2026-07-24, accesibilidad): sin focus trap ni
  // foco inicial, Tab podía escapar hacia elementos de fondo mientras el
  // modal estaba abierto. modalRef delimita el contenedor para el trap y
  // para ubicar el primer elemento focuseable al montar.
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const modalNode = modalRef.current;
    if (!modalNode) return;

    const getFocusable = () =>
      Array.from(
        modalNode.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));

    // Foco inicial al primer elemento interactivo visible según el `mode` actual.
    const focusable = getFocusable();
    focusable[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const elements = getFocusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !modalNode.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !modalNode.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, otpSent]);

  // Fix (auditoría externa 2026-07-24, accesibilidad): el modal no se podía
  // cerrar con Escape. Respeta el mismo criterio que el botón "X" (línea
  // ~238): cuando forcePhoneVerification es true, el modal no debe poder
  // cerrarse, así que ni se agrega el listener.
  useEffect(() => {
    if (forcePhoneVerification) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [forcePhoneVerification, onClose]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const currentPath = window.location.pathname;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(currentPath)}`,
        },
      });
      if (error) throw error;
      // OAuth redirects, so onSuccess is called from callback page
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : t("errors.googleFailed"));
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const currentPath = window.location.pathname;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(currentPath)}`,
        },
      });
      if (error) throw error;
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : t("errors.appleFailed"));
      setLoading(false);
    }
  };

  const handleEmailOtpRequest = async () => {
    if (!email || !EMAIL_REGEX.test(email)) {
      setError(t("errors.invalidEmail"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Usar signInWithOtp SIN emailRedirectTo para forzar envío de token (código)
      // en vez de magic link. El template de Supabase debe usar {{ .Token }}.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        // NO incluir options.emailRedirectTo — eso fuerza magic link
      });
      if (error) throw error;
      setOtpSent(true);
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : t("errors.sendCodeFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneOtpRequest = async () => {
    if (!phone || phone.length < 10) {
      setError(t("errors.invalidPhone"));
      return;
    }
    // Normalizar a E.164 para Canadá/EE.UU.
    const normalizedPhone = phone.startsWith("+") ? phone : `+1${phone}`;
    setLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
      });
      if (error) throw error;
      setOtpSent(true);
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : t("errors.sendSmsFailed"));
    } finally {
      setLoading(false);
    }
  };

  // v8.3 fix (auditoría E1): a diferencia de handlePhoneOtpRequest (que hace
  // signInWithOtp y crearía una cuenta/identidad NUEVA), aquí el usuario ya
  // tiene sesión (llegó por Google/Apple) -- updateUser({ phone }) envía el
  // código al número nuevo y lo asocia a la MISMA cuenta autenticada.
  const handleLinkPhoneRequest = async () => {
    if (!phone || phone.length < 10) {
      setError(t("errors.invalidPhone"));
      return;
    }
    const normalizedPhone = phone.startsWith("+") ? phone : `+1${phone}`;
    setLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalizedPhone });
      if (error) throw error;
      setOtpSent(true);
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : t("errors.sendSmsFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyLinkedPhone = async () => {
    if (!otpCode || otpCode.length < 6) {
      setError(t("errors.invalidCode"));
      return;
    }
    if (!phone || phone.length < 10) {
      setError(t("errors.phoneRequired"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const normalizedPhone = phone.startsWith("+") ? phone : `+1${phone}`;
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token: otpCode,
        type: "phone_change",
      });
      if (verifyError) throw verifyError;

      // Persistir phone_verified=true en client_profiles -- es lo que el
      // resto del sistema (reserva, recordatorios SMS) consulta. RLS
      // (migración 018) permite que el usuario actualice su propia fila.
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await supabase
          .from("client_profiles")
          .update({ phone_verified: true, phone_number: normalizedPhone })
          .eq("user_id", userData.user.id);
      }

      onSuccess();
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : t("errors.invalidVerificationCode"));
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length < 6) {
      setError(t("errors.invalidCode"));
      return;
    }
    // Validate email/phone is still present
    if (mode === "email" && (!email || !EMAIL_REGEX.test(email))) {
      setError(t("errors.emailRequired"));
      return;
    }
    if (mode === "phone" && (!phone || phone.length < 10)) {
      setError(t("errors.phoneRequired"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      let result;
      if (mode === "email") {
        result = await supabase.auth.verifyOtp({
          email,
          token: otpCode,
          type: "email",
        });
      } else {
        const normalizedPhone = phone.startsWith("+") ? phone : `+1${phone}`;
        result = await supabase.auth.verifyOtp({
          phone: normalizedPhone,
          token: otpCode,
          type: "sms",
        });
      }
      if (result.error) throw result.error;

      // v8.3 fix (auditoría E1): el login por teléfono+OTP YA prueba
      // posesión del número -- marcar phone_verified aquí evita pedirle
      // este mismo paso de nuevo más adelante en la reserva.
      if (mode === "phone") {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          const normalizedPhone = phone.startsWith("+") ? phone : `+1${phone}`;
          await supabase
            .from("client_profiles")
            .update({ phone_verified: true, phone_number: normalizedPhone })
            .eq("user_id", userData.user.id);
        }
      }

      onSuccess();
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : t("errors.invalidVerificationCode"));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className="bg-white rounded-lg shadow-elevation-3 max-w-md w-full p-6 relative"
      >
        {!forcePhoneVerification && (
          <button
            aria-label={t("closeAriaLabel")}
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        <h2 id="auth-modal-title" className="text-xl font-bold text-brand-ink mb-2">
          {forcePhoneVerification ? t("verifyPhoneTitle") : t("signInTitle")}
        </h2>
        <p className="text-gray-600 text-sm mb-6">
          {forcePhoneVerification ? (
            // v8.3 fix (auditoría E1): paso obligatorio tras login social
            // (Google/Apple) -- sin esto, la cuenta nunca puede recibir
            // recordatorios SMS ni confirmar identidad por teléfono, y el
            // spec exige verificación telefónica para TODA reserva.
            t("verifyPhoneDesc")
          ) : (
            <>
              {/* v8.3 fix (auditoría 2026-07-15): el texto anterior ("All methods
                  create the same secure account") era falso -- no existe account
                  linking en el código; Google, Apple y email/phone OTP crean
                  cuentas SEPARADAS en Supabase Auth por defecto. Un cliente que
                  reserva con Google y luego entra con email pierde su historial,
                  wallet y cotizaciones previas sin ningún aviso. Se corrige el
                  texto para reflejar la realidad y se pide explícitamente usar
                  siempre el mismo método. */}
              {t("sameMethodWarning")}
            </>
          )}
        </p>

        {error && (
          // Fix (auditoría externa 2026-07-24, accesibilidad): role="alert"
          // hace que lectores de pantalla anuncien el error automáticamente
          // (equivale a aria-live="assertive" en la mayoría de lectores).
          <div role="alert" className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {mode === "verify_phone" && (
          <div className="space-y-4">
            {!otpSent ? (
              <>
                <div>
                  <label htmlFor="auth-link-phone-input" className="block text-sm font-medium text-brand-ink mb-1">
                    {t("phoneNumberLabel")}
                  </label>
                  <input
                    id="auth-link-phone-input"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    placeholder="6041234567"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t("phoneHint")}</p>
                </div>
                <button
                  aria-label={t("sendLinkedSmsCodeAriaLabel")}
                  onClick={handleLinkPhoneRequest}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? t("sending") : t("sendSmsCode")}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="auth-otp-link-phone-input" className="block text-sm font-medium text-brand-ink mb-1">
                    {t("enterCodeSentTo", { destination: phone })}
                  </label>
                  <input
                    id="auth-otp-link-phone-input"
                    type="text"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center text-lg tracking-widest"
                  />
                </div>
                <button
                  aria-label={t("verifyPhoneCodeAriaLabel")}
                  onClick={handleVerifyLinkedPhone}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? t("verifying") : t("verifyPhone")}
                </button>
                <button
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                  }}
                  className="w-full text-sm text-brand-wave-blue hover:underline"
                >
                  {t("resendPhone")}
                </button>
              </>
            )}
          </div>
        )}

        {mode === "options" && (
          <div className="space-y-3">
            <button
              aria-label={t("continueWithGoogle")}
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Globe className="w-5 h-5 text-blue-500" />
              <span className="font-medium">{t("continueWithGoogle")}</span>
            </button>

            <button
              aria-label={t("continueWithApple")}
              onClick={handleAppleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Apple className="w-5 h-5 text-black" />
              <span className="font-medium">{t("continueWithApple")}</span>
            </button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">{t("or")}</span>
              </div>
            </div>

            <button
              onClick={() => setMode("email")}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Mail className="w-5 h-5 text-brand-wave-blue" />
              <span className="font-medium">{t("emailOption")}</span>
            </button>

            <button
              onClick={() => setMode("phone")}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Smartphone className="w-5 h-5 text-brand-wave-blue" />
              <span className="font-medium">{t("phoneOption")}</span>
            </button>
          </div>
        )}

        {mode === "email" && (
          <div className="space-y-4">
            {!otpSent ? (
              <>
                <div>
                  <label htmlFor="auth-email-input" className="block text-sm font-medium text-brand-ink mb-1">
                    {t("emailAddressLabel")}
                  </label>
                  <input
                    id="auth-email-input"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
                  />
                </div>
                <button
                  aria-label={t("sendEmailCodeAriaLabel")}
                  onClick={handleEmailOtpRequest}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? t("sending") : t("sendVerificationCode")}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="auth-otp-email-input" className="block text-sm font-medium text-brand-ink mb-1">
                    {t("enterCodeSentTo", { destination: email })}
                  </label>
                  <input
                    id="auth-otp-email-input"
                    type="text"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center text-lg tracking-widest"
                  />
                </div>
                <button
                  aria-label={t("verifyAndSignInAriaLabel")}
                  onClick={handleVerifyOtp}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? t("verifying") : t("verifyAndSignIn")}
                </button>
                <button
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                  }}
                  className="w-full text-sm text-brand-wave-blue hover:underline"
                >
                  {t("resendEmail")}
                </button>
              </>
            )}
            <button
              onClick={() => setMode("options")}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              {t("backToAllOptions")}
            </button>
          </div>
        )}

        {mode === "phone" && (
          <div className="space-y-4">
            {!otpSent ? (
              <>
                <div>
                  <label htmlFor="auth-phone-input" className="block text-sm font-medium text-brand-ink mb-1">
                    {t("phoneNumberLabel")}
                  </label>
                  <input
                    id="auth-phone-input"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    placeholder="6041234567"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t("phoneHint")}</p>
                </div>
                <button
                  aria-label={t("sendSmsCodeAriaLabel")}
                  onClick={handlePhoneOtpRequest}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? t("sending") : t("sendSmsCode")}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="auth-otp-phone-input" className="block text-sm font-medium text-brand-ink mb-1">
                    {t("enterCodeSentTo", { destination: phone })}
                  </label>
                  <input
                    id="auth-otp-phone-input"
                    type="text"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center text-lg tracking-widest"
                  />
                </div>
                <button
                  aria-label={t("verifyAndSignInAriaLabel")}
                  onClick={handleVerifyOtp}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? t("verifying") : t("verifyAndSignIn")}
                </button>
                <button
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                  }}
                  className="w-full text-sm text-brand-wave-blue hover:underline"
                >
                  {t("resendPhone")}
                </button>
              </>
            )}
            <button
              onClick={() => setMode("options")}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              {t("backToAllOptions")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
