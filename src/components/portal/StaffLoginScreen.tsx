"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { isAllowedInternalPath } from "@/lib/safe-redirect";
import { Shield, Loader2 } from "lucide-react";

// Fix (auditoría 2026-07-31, hallazgo confirmado): `!email.includes("@")` dejaba
// pasar strings como "a@b" o "@@@" -- mismo problema ya identificado y arreglado
// en src/components/cotizador/AuthModal.tsx (auditoría externa 2026-07-24).
// Regex simple de formato, no pretende cubrir RFC 5322 completo.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface StaffLoginScreenProps {
  locale: string;
  error?: string;
}

/**
 * v8.3 — Portal de equipo unificado (login staff).
 *
 * Reemplaza el par AdminLoginScreen/EmployeeAuthModal como punto de entrada
 * ÚNICO para las 4 categorías de staff (empleado, ops_coordinator, qc_only,
 * owner_admin). El método principal solo hace una cosa: autenticar con
 * Google y mandar al usuario a /auth/callback?next=/{locale}/portal, donde
 * la página server ejecuta el lookup real
 * (src/app/api/staff/resolve-login/route.ts) contra employees + admin_roles
 * y decide a dónde va cada quien -- este componente NUNCA decide
 * autorización por sí mismo.
 *
 * v8.3 fix G-1: antes de esto, el método de rescate para el owner_admin
 * (login por código de respaldo, para cuando Google es inaccesible) SOLO
 * existía en AdminLoginScreen.tsx (eliminado). Al colapsar admin/layout.tsx
 * y empleado/page.tsx para que ambos redirijan a /portal, ese componente
 * dejó de estar en ninguna ruta -- así que la capacidad se migra aquí,
 * detrás de "Otras opciones de acceso" (oculta por defecto, ya que
 * empleados normales nunca la necesitan). El login por código OTP de email
 * también se migra por completo (mismo mecanismo ya usado en
 * src/components/cotizador/AuthModal.tsx) como alterna adicional a Google.
 */
export default function StaffLoginScreen({ locale, error: initialError }: StaffLoginScreenProps) {
  const t = useTranslations("portal.staffLogin");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [mode, setMode] = useState<"google" | "options" | "email" | "backup-code">("google");
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");

  // Fix (auditoría 2026-07-31, hallazgo confirmado): el rate-limit real
  // (el que de verdad importa contra fuerza bruta) ya vive en el servidor
  // -- ver src/app/api/admin/backup-codes/verify/route.ts -- pero la UI no
  // tenía NINGÚN freno propio: un atacante con el formulario abierto podía
  // enviar intento tras intento visualmente sin fricción, aunque el
  // servidor los fuera rechazando igual. Se agrega un contador simple de
  // intentos fallidos + cooldown puramente client-side (UX, no es la
  // defensa de seguridad real) para desalentar el "fuerza bruta visual" y
  // dar feedback claro en vez de dejar el botón siempre listo para el
  // siguiente intento.
  const BACKUP_CODE_MAX_ATTEMPTS = 5;
  const BACKUP_CODE_COOLDOWN_MS = 30_000;
  const [backupCodeFailures, setBackupCodeFailures] = useState(0);
  const [backupCodeCooldownUntil, setBackupCodeCooldownUntil] = useState<number | null>(null);
  const [backupCodeCooldownRemaining, setBackupCodeCooldownRemaining] = useState(0);

  useEffect(() => {
    if (!backupCodeCooldownUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((backupCodeCooldownUntil - Date.now()) / 1000));
      setBackupCodeCooldownRemaining(remaining);
      if (remaining <= 0) {
        setBackupCodeCooldownUntil(null);
        setBackupCodeFailures(0);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [backupCodeCooldownUntil]);

  const isBackupCodeInCooldown = backupCodeCooldownUntil !== null && backupCodeCooldownRemaining > 0;

  // Fix (auditoría 2026-07-31, hallazgo confirmado): admin/layout.tsx y
  // empleado/layout.tsx mandan aquí con `?next=<ruta original protegida>`
  // (ver comentario en admin/layout.tsx, línea ~104) para que, tras
  // autenticarse, el usuario vuelva a la página profunda que pidió en vez
  // de aterrizar siempre en el landing genérico del área
  // (portal/page.tsx ya sabe usar ese `next` -- ver isSameArea/safeNext ahí).
  // Este componente ignoraba por completo ese `next` al armar `redirectTo`:
  // el auth callback siempre volvía a `/${locale}/portal` a secas, así que
  // portal/page.tsx nunca veía el `next` original y todo el mundo terminaba
  // en el landing del área sin importar qué página profunda pidió primero.
  // Se lee de window.location.search (esta pantalla vive en /portal, la
  // misma URL que recibió el `next`), se valida con isAllowedInternalPath
  // (misma allowlist que ya usan portal/page.tsx y auth/callback) y, si es
  // válido, se reenvía como querystring del destino final tras el callback.
  const getSafeNextParam = (): string | null => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("next");
    return isAllowedInternalPath(raw) ? raw : null;
  };

  const buildPortalRedirectTarget = (): string => {
    const safeNext = getSafeNextParam();
    const portalPath = `/${locale}/portal`;
    return safeNext ? `${portalPath}?next=${encodeURIComponent(safeNext)}` : portalPath;
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(buildPortalRedirectTarget())}`,
          // Fix (auditoría de login 2026-08-02): sin esto, Google puede reusar
          // silenciosamente la sesión/cookie ya activa (el "authuser" index)
          // en vez de honrar la cuenta que el usuario clickea en el selector,
          // cuando hay más de una cuenta de Google abierta en el navegador.
          // No es un hueco de seguridad -- resolveStaffLogin()/admin_roles
          // sigue rechazando cuentas sin rol -- pero causaba confusión real
          // ("This account isn't registered as staff" con la cuenta correcta
          // clickeada). Forzar el selector cada vez lo evita.
          queryParams: {
            prompt: "select_account",
          },
        },
      });
      if (error) throw error;
    } catch {
      // Fix (auditoría de autenticación 2026-07-25/26, item 1): nunca mostrar
      // err.message crudo de Supabase Auth al usuario -- mismo patrón que
      // src/components/cotizador/AuthModal.tsx (item 13).
      setIsLoading(false);
      setError(t("errors.googleFailed"));
    }
  };

  // Login alterno por código de email. No sustituye a Google como método
  // principal recomendado -- RBAC lo sigue controlando resolveStaffLogin()
  // (src/lib/staff-login.ts) independientemente del método de login, así
  // que autenticarse por código no da acceso por sí solo: solo entra quien
  // ya esté en employees o admin_roles.
  const handleEmailOtpRequest = async () => {
    if (!email || !EMAIL_REGEX.test(email.trim())) {
      setError(t("errors.invalidEmail"));
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      // emailRedirectTo -> /auth/callback: sin un template de email con
      // {{ .Token }} configurado, Supabase manda un magic link (no un
      // código de 6 dígitos) -- ver comentario histórico en el
      // AdminLoginScreen.tsx original. El link es la instrucción primaria;
      // el código queda como alterna solo por si el proyecto llega a
      // configurar ese template más adelante.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(buildPortalRedirectTarget())}`,
          // v8.3 fix M-5 (auditoría go-live 2026-07-20): sin esto, cualquiera
          // podía hacer que Supabase creara una fila nueva en auth.users con
          // un email arbitrario con solo pedir el código -- no otorgaba
          // acceso real (RBAC en /api/staff/resolve-login sigue rechazando a
          // quien no esté en employees/admin_roles), pero permitía ensuciar
          // la tabla de usuarios sin necesidad. shouldCreateUser:false exige
          // que la cuenta ya exista de antemano.
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      setOtpSent(true);
    } catch {
      // Fix (item 1): nunca mostrar err.message crudo de Supabase Auth.
      setError(t("errors.sendCodeFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length < 6) {
      setError(t("errors.invalidCode"));
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: "email",
      });
      if (error) throw error;
      window.location.reload();
    } catch {
      // Fix (item 1): nunca mostrar err.message crudo de Supabase Auth.
      setError(t("errors.invalidVerificationCode"));
      setIsLoading(false);
    }
  };

  // Login con código de respaldo (backup code), para cuando el owner_admin
  // no puede usar Google. Ver comentario extenso en
  // src/app/api/admin/backup-codes/verify/route.ts sobre cómo se crea la
  // sesión: ese endpoint valida el código (server-side, service role),
  // marca el código como usado, y canjea el magic-link nativo de Supabase
  // completamente server-side (fix BUG-2 auditoría 2026-07-30) -- la sesión
  // queda establecida vía cookie en la propia respuesta de este fetch, así
  // que este handler ya no recibe ni maneja ningún secreto: solo confirma
  // éxito y recarga.
  const handleBackupCodeSignIn = async () => {
    if (isBackupCodeInCooldown) return;
    if (!backupCode.trim()) {
      setError(t("errors.backupCodeRequired"));
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/backup-codes/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // credentials:"include" explícito (fetch ya lo hace por defecto en
        // same-origin, pero se agrega por consistencia con el resto del
        // proyecto -- ver /api/staff/resolve-login en portal/page.tsx -- y
        // como defensa en profundidad si este fetch alguna vez se mueve a un
        // contexto cross-origin).
        credentials: "include",
        body: JSON.stringify({ code: backupCode }),
      });
      // Fix (item 1): antes se propagaba json.error (mensaje del servidor,
      // potencialmente técnico) directo al usuario vía new Error(...).message
      // más abajo. Se usa siempre el mensaje genérico localizado.
      if (!res.ok) throw new Error("backup_code_failed");

      window.location.reload();
    } catch {
      const nextFailures = backupCodeFailures + 1;
      if (nextFailures >= BACKUP_CODE_MAX_ATTEMPTS) {
        setBackupCodeCooldownUntil(Date.now() + BACKUP_CODE_COOLDOWN_MS);
        setBackupCodeFailures(0);
        setError(t("errors.backupCodeTooManyAttempts", { seconds: Math.ceil(BACKUP_CODE_COOLDOWN_MS / 1000) }));
      } else {
        setBackupCodeFailures(nextFailures);
        setError(t("errors.backupCodeFailed"));
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center space-y-6">
        <div className="w-12 h-12 bg-brand-navy/10 rounded-full flex items-center justify-center mx-auto">
          <Shield className="w-6 h-6 text-brand-navy" />
        </div>
        <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500">{t("subtitle")}</p>

        {mode === "google" && (
          <>
            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              aria-label={t("googleSignIn")}
              className="w-full bg-white border border-gray-300 text-brand-ink py-2.5 rounded-lg font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  {t("googleSignIn")}
                </>
              )}
            </button>
            {/* v8.3 fix G-1: capacidades de rescate migradas de
                AdminLoginScreen.tsx (eliminado) -- ocultas detrás de este
                toggle porque solo aplican a un owner_admin sin acceso a
                Google, nunca a empleados normales. */}
            <button
              onClick={() => setMode("options")}
              className="w-full text-xs text-gray-400 hover:text-gray-600 hover:underline"
            >
              {t("otherOptions")}
            </button>
          </>
        )}

        {mode === "options" && (
          <>
            <button
              onClick={() => setMode("email")}
              className="w-full text-sm text-brand-wave-blue hover:underline"
            >
              {t("options.useEmailCode")}
            </button>
            <button
              onClick={() => setMode("backup-code")}
              className="w-full text-sm text-gray-500 hover:text-gray-700 hover:underline"
            >
              {t("options.useBackupCode")}
            </button>
            <button
              onClick={() => setMode("google")}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              {t("options.back")}
            </button>
          </>
        )}

        {mode === "backup-code" && (
          <div className="space-y-3 text-left">
            <div>
              <label htmlFor="staff-login-backup-code" className="block text-sm font-medium text-brand-ink mb-1">
                {t("backupCode.label")}
              </label>
              <p className="text-xs text-gray-500 mb-2">{t("backupCode.hint")}</p>
              <input
                id="staff-login-backup-code"
                type="text"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value)}
                placeholder={t("backupCode.placeholder")}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center tracking-widest"
              />
            </div>
            <button
              onClick={handleBackupCodeSignIn}
              disabled={isLoading || isBackupCodeInCooldown}
              aria-label={isLoading ? t("backupCode.ariaVerifying") : t("backupCode.ariaSignIn")}
              className="w-full bg-brand-navy text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {isBackupCodeInCooldown
                ? t("errors.backupCodeTooManyAttempts", { seconds: backupCodeCooldownRemaining })
                : isLoading
                  ? t("backupCode.submitting")
                  : t("backupCode.submit")}
            </button>
            <button
              onClick={() => {
                setMode("options");
                setBackupCode("");
                setError("");
              }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              {t("options.back")}
            </button>
          </div>
        )}

        {mode === "email" && !otpSent && (
          <div className="space-y-3 text-left">
            <div>
              <label htmlFor="staff-login-email" className="block text-sm font-medium text-brand-ink mb-1">
                {t("email.label")}
              </label>
              <input
                id="staff-login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("email.placeholder")}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
              />
            </div>
            <button
              onClick={handleEmailOtpRequest}
              disabled={isLoading}
              aria-label={isLoading ? t("email.sendButtonAriaSending") : t("email.sendButtonAria")}
              className="w-full bg-brand-navy text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {isLoading ? t("email.sendButtonSending") : t("email.sendButton")}
            </button>
            <button
              onClick={() => setMode("options")}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              {t("options.back")}
            </button>
          </div>
        )}

        {mode === "email" && otpSent && (
          <div className="space-y-3 text-left">
            <p className="text-sm text-brand-ink">
              {t("email.otpSentMessage", { email })}
            </p>
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-700">
                {t("email.otpAltSummary")}
              </summary>
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  aria-label={t("email.otpCodeAriaLabel")}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center text-lg tracking-widest"
                />
                <button
                  onClick={handleVerifyOtp}
                  disabled={isLoading}
                  aria-label={isLoading ? t("email.verifyButtonAriaVerifying") : t("email.verifyButtonAria")}
                  className="w-full bg-brand-navy text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {isLoading ? t("email.verifyButtonVerifying") : t("email.verifyButton")}
                </button>
              </div>
            </details>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>
        )}
        <p className="text-xs text-gray-400">{t("footerNotice")}</p>
      </div>
    </div>
  );
}
