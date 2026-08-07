"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { isAllowedInternalPath } from "@/lib/safe-redirect";
import { Mail, Smartphone, X } from "lucide-react";

// Fix (auditoría en vivo 2026-08-01, confianza/branding): los botones de
// "Continue with Google"/"Continue with Apple" usaban íconos genéricos de
// lucide-react (Globe azul, Apple negro) en vez de los logos reales -- un
// usuario que conoce los botones oficiales nota la diferencia y puede
// interpretarlo como señal de phishing. Se reemplazan por el logo oficial
// multicolor de Google ("G", guía de marca de Google Identity) y el botón
// oficial "Sign in with Apple" (negro sólido, logo blanco, guía de Apple
// Human Interface Guidelines) en vez de reusar el mismo estilo de botón
// outline blanco que el resto de opciones.
function GoogleLogo() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

// Fix (auditoría externa 2026-07-24, accesibilidad): validación de email
// débil (`!email.includes("@")` dejaba pasar "a@b" o "@@@"). Regex simple
// de formato -- no pretende cubrir RFC 5322 completo, solo atrapar los
// casos obvios que la auditoría señaló.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fix (auditoría externa 2026-07-30, BUG 1): antes se concatenaba "+1" a
// ciegas (`phone.startsWith("+") ? phone : \`+1${phone}\``) sin validar que
// el resto fuera un número norteamericano de 10 dígitos. El input de
// teléfono ya fuerza solo dígitos (onChange hace `.replace(/\D/g, "")`), así
// que en la práctica el "+" nunca llega desde esta UI -- pero el chequeo
// viejo (`phone.length < 10`, un mínimo sin techo) dejaba pasar 11+ dígitos
// (ej. el usuario tipeó el "1" del código de país a mano: "16041234567") y
// generaba un E.164 incorrecto ("+116041234567"). Ahora exige exactamente 10
// dígitos para el caso sin "+", devolviendo null si no cumple.
function normalizePhone(rawPhone: string): string | null {
  if (rawPhone.startsWith("+")) return rawPhone;
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return `+1${digits}`;
}

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
  // Sign Up mode: when true, shows a registration form with name fields
  // alongside social login and email/phone OTP options.
  signupMode?: boolean;
  // Redirect path after OAuth (Google/Apple). When set, the callback
  // sends the user here instead of back to the current page.
  postLoginRedirect?: string;
}

export function AuthModal({ onClose, onSuccess, initialError, forcePhoneVerification, signupMode, postLoginRedirect }: AuthModalProps) {
  const t = useTranslations("cotizador.authModal");
  const isSignup = Boolean(signupMode);
  const [mode, setMode] = useState<"options" | "email" | "phone" | "verify_phone" | "signup_form">(
    forcePhoneVerification ? "verify_phone" : isSignup ? "signup_form" : "options"
  );
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  // Fix (auditoría UX/seguridad 2026-07-30, BUG 5): el botón de reenviar
  // código no tenía cooldown ni throttle visual -- un usuario (o un script)
  // podía volver a la pantalla de envío y disparar signInWithOtp sin límite.
  // Nota: Supabase Auth ya aplica su propio rate limit server-side sobre el
  // endpoint de OTP (por defecto ~60s entre envíos por email/teléfono,
  // configurable en el proyecto de Supabase) -- esto es defensa en
  // profundidad, no la protección real. Este cooldown es solo UX: evita que
  // el cliente golpee el botón y reciba silenciosamente el rate-limit error
  // de Supabase sin ningún indicio de por qué "no pasó nada".
  const RESEND_COOLDOWN_SECONDS = 45;
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownEndRef = useRef<number | null>(null);

  function startResendCooldown() {
    cooldownEndRef.current = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  useEffect(() => {
    const interval = setInterval(() => {
      const end = cooldownEndRef.current;
      if (!end) return;
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setResendCooldown((prev) => (prev !== remaining ? remaining : prev));
      if (remaining <= 0) cooldownEndRef.current = null;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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

  // Fix (auditoría 2026-07-31, hallazgo confirmado): handleGoogleSignIn y
  // handleAppleSignIn usaban window.location.pathname a secas como destino
  // post-login, ignorando cualquier `?next=` que middleware.ts pudiera haber
  // puesto en la URL actual (ej. tras redirigir desde /cuenta/algo protegido
  // de vuelta al home con `?next=/es/cuenta/algo`, ver clientProtectedPrefixes
  // en middleware.ts). Se prioriza `next` (validado con isAllowedInternalPath,
  // misma allowlist que ya usan /portal y /auth/callback) sobre el pathname
  // actual; si no hay `next` válido, se cae al comportamiento de siempre
  // (volver a la página donde se abrió el modal).
  const getPostLoginRedirectPath = (): string => {
    // If the caller provided an explicit post-login path, use it.
    if (postLoginRedirect && isAllowedInternalPath(postLoginRedirect)) return postLoginRedirect;
    const rawNext = new URLSearchParams(window.location.search).get("next");
    return isAllowedInternalPath(rawNext) ? rawNext : window.location.pathname;
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const currentPath = getPostLoginRedirectPath();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(currentPath)}`,
          // Fix (auditoría de login 2026-08-02): fuerza el selector de cuenta
          // de Google en vez de dejar que reuse silenciosamente la sesión ya
          // activa (ver mismo fix en StaffLoginScreen.tsx).
          queryParams: {
            prompt: "select_account",
          },
        },
      });
      if (error) throw error;
      // OAuth redirects, so onSuccess is called from callback page
    } catch {
      // Fix (auditoría UX/seguridad 2026-07-25, item 13): antes se mostraba
      // err.message crudo de Supabase Auth directo al cliente (fuga de
      // detalles técnicos internos: nombres de tabla, mensajes de API, etc.).
      // Se usa siempre el mensaje genérico localizado, sin importar qué
      // devuelva Supabase.
      setError(t("errors.googleFailed"));
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const currentPath = getPostLoginRedirectPath();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(currentPath)}`,
        },
      });
      if (error) throw error;
    } catch {
      // Fix (item 13): nunca mostrar err.message crudo de Supabase Auth.
      setError(t("errors.appleFailed"));
      setLoading(false);
    }
  };

  const handleSignupContinue = () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError(t("nameRequired"));
      return;
    }
    setError("");
    setMode("options");
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
      startResendCooldown();
    } catch {
      // Fix (item 13): nunca mostrar err.message crudo de Supabase Auth.
      setError(t("errors.sendCodeFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneOtpRequest = async () => {
    if (!phone || phone.length < 10) {
      setError(t("errors.invalidPhone"));
      return;
    }
    // Fix (auditoría 2026-07-30, BUG 1): normalizar a E.164 validando formato
    // (ver normalizePhone arriba) en vez de concatenar "+1" ciegamente.
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      setError(t("errors.invalidPhone"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
      });
      if (error) throw error;
      setOtpSent(true);
      startResendCooldown();
    } catch (err) {
      // Fix (auditoría 2026-07-30, BUG 1): antes SIEMPRE se mostraba el
      // mensaje genérico sin importar la causa real (ej. el número ya está
      // vinculado a otra cuenta). Supabase Auth expone `code` en AuthApiError
      // (ver node_modules/@supabase/auth-js/src/lib/error-codes.ts) --
      // "phone_exists" es el único código con un mensaje específico útil
      // aquí. El resto de causas se loguea a consola para debug pero
      // mantiene el mensaje genérico como fallback -- sigue sin mostrarse
      // err.message crudo de Supabase al cliente (mismo criterio que el
      // resto de catch blocks de este archivo, item 13).
      console.error("handlePhoneOtpRequest error:", err);
      const code = (err as { code?: string } | null | undefined)?.code;
      setError(code === "phone_exists" ? t("errors.phoneAlreadyRegistered") : t("errors.sendSmsFailed"));
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
    // Fix (auditoría 2026-07-30, BUG 1): ver normalizePhone arriba -- no
    // concatenar "+1" ciegamente.
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      setError(t("errors.invalidPhone"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalizedPhone });
      if (error) throw error;
      setOtpSent(true);
      startResendCooldown();
    } catch (err) {
      // Fix (auditoría 2026-07-30, BUG 1): este es el caso donde el conflicto
      // "número ya registrado en otra cuenta" es MÁS probable de los dos
      // (updateUser intenta vincular el número a la cuenta ya autenticada por
      // Google/Apple -- si ese número ya es el teléfono de OTRA cuenta,
      // Supabase responde con code "phone_exists"). Mismo criterio que
      // handlePhoneOtpRequest: loguear el error real y solo caer al mensaje
      // genérico si no es un código reconocido.
      console.error("handleLinkPhoneRequest error:", err);
      const code = (err as { code?: string } | null | undefined)?.code;
      setError(code === "phone_exists" ? t("errors.phoneAlreadyRegistered") : t("errors.sendSmsFailed"));
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
      const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      setError(t("errors.invalidPhone"));
      setLoading(false);
      return;
    }
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token: otpCode,
        type: "phone_change",
      });
      if (verifyError) throw verifyError;

      // Persistir phone_verified=true en client_profiles -- es lo que el
      // resto del sistema (reserva, recordatorios SMS) consulta. RLS
      // (migración 018) permite que el usuario actualice su propia fila.
      // Fix (auditoría seguridad 2026-07-26): antes era un .update(), que no
      // hace nada (sin error visible) si la fila todavía no existe -- ej. si
      // el trigger de Supabase que debería crearla en signup no corrió.
      // upsert con onConflict "user_id" garantiza que la fila se cree si
      // falta, en vez de fallar en silencio.
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await supabase
          .from("client_profiles")
          .upsert(
            { user_id: userData.user.id, phone_verified: true, phone_number: normalizedPhone },
            { onConflict: "user_id" }
          );
      }

      onSuccess();
    } catch {
      // Fix (item 13): nunca mostrar err.message crudo de Supabase Auth.
      setError(t("errors.invalidVerificationCode"));
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    // Guardar nombre en client_profiles si estamos en modo signup
    async function saveSignupName() {
      if (!isSignup || !firstName.trim() || !lastName.trim()) return;
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;
        await supabase.from("client_profiles").upsert(
          { user_id: userData.user.id, first_name: firstName.trim(), last_name: lastName.trim() },
          { onConflict: "user_id" }
        );
      } catch {
        // Best-effort: no bloqueamos el flujo si falla
      }
    }

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
        const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      setError(t("errors.invalidPhone"));
      setLoading(false);
      return;
    }
        result = await supabase.auth.verifyOtp({
          phone: normalizedPhone,
          token: otpCode,
          type: "sms",
        });
      }
      if (result.error) throw result.error;

      // Si estamos en modo signup con nombres ingresados, guardarlos en
      // client_profiles (best-effort, no bloquea el flujo si falla).
      await saveSignupName();

      // v8.3 fix (auditoría E1): el login por teléfono+OTP YA prueba
      // posesión del número -- marcar phone_verified aquí evita pedirle
      // este mismo paso de nuevo más adelante en la reserva.
      if (mode === "phone") {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      setError(t("errors.invalidPhone"));
      setLoading(false);
      return;
    }
          // Fix (auditoría seguridad 2026-07-26): mismo problema que
          // handleVerifyLinkedPhone -- .update() no hace nada si la fila de
          // client_profiles todavía no existe. upsert garantiza que se cree.
          await supabase
            .from("client_profiles")
            .upsert(
              { user_id: userData.user.id, phone_verified: true, phone_number: normalizedPhone },
              { onConflict: "user_id" }
            );
        }
      }

      onSuccess();
    } catch {
      // Fix (item 13): nunca mostrar err.message crudo de Supabase Auth.
      setError(t("errors.invalidVerificationCode"));
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
          {forcePhoneVerification ? t("verifyPhoneTitle") : isSignup ? t("signUpTitle") : t("signInTitle")}
        </h2>
        <p className="text-gray-600 text-sm mb-6">
          {forcePhoneVerification
            ? t("verifyPhoneDesc")
            : isSignup && mode === "signup_form"
              ? t("signUpSubtitle")
              : t("sameMethodWarning")}
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
                  disabled={resendCooldown > 0}
                  className="w-full text-sm text-brand-wave-blue hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
                >
                  {resendCooldown > 0 ? t("resendIn", { seconds: resendCooldown }) : t("resendPhone")}
                </button>
              </>
            )}
          </div>
        )}

        {mode === "signup_form" && (
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-firstname" className="block text-sm font-medium text-brand-ink mb-1">
                {t("firstNameLabel")}
              </label>
              <input
                id="auth-firstname"
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
              />
            </div>
            <div>
              <label htmlFor="auth-lastname" className="block text-sm font-medium text-brand-ink mb-1">
                {t("lastNameLabel")}
              </label>
              <input
                id="auth-lastname"
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
              />
            </div>
            <button
              onClick={handleSignupContinue}
              className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors"
            >
              {t("continueButton")}
            </button>
          </div>
        )}

        {mode === "options" && (
          <div className="space-y-3">
            <button
              aria-label={t("continueWithGoogle")}
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <GoogleLogo />
              <span className="font-medium text-[#3c4043]">{t("continueWithGoogle")}</span>
            </button>

            {/* Apple OAuth — disabled until provider is enabled in Supabase
                 (Auth → Providers → Apple). When ready, uncomment the block below
                 and set NEXT_PUBLIC_APPLE_OAUTH_ENABLED=true in .env. */}
            {process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED === "true" && (
            <button
              aria-label={t("continueWithApple")}
              onClick={handleAppleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg bg-black text-white hover:bg-gray-900 transition-colors disabled:opacity-50"
            >
              <AppleLogo />
              <span className="font-medium">{t("continueWithApple")}</span>
            </button>
            )}
            {/* v8.3 fix (auditoría 2026-07-15): el texto anterior ("All methods
                create the same secure account") era falso -- no existe account
                linking en el código; Google, Apple y email/phone OTP crean
                cuentas SEPARADAS en Supabase Auth por defecto. Un cliente que
                reserva con Google y luego entra con email pierde su historial,
                wallet y cotizaciones previas sin ningún aviso. Se corrige el
                texto para reflejar la realidad y se pide explícitamente usar
                siempre el mismo método. */}

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
                  disabled={resendCooldown > 0}
                  className="w-full text-sm text-brand-wave-blue hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
                >
                  {resendCooldown > 0 ? t("resendIn", { seconds: resendCooldown }) : t("resendEmail")}
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
                  disabled={resendCooldown > 0}
                  className="w-full text-sm text-brand-wave-blue hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
                >
                  {resendCooldown > 0 ? t("resendIn", { seconds: resendCooldown }) : t("resendPhone")}
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
