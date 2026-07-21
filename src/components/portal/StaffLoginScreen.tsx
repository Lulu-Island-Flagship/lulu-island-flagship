"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Shield, Loader2 } from "lucide-react";

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [mode, setMode] = useState<"google" | "options" | "email" | "backup-code">("google");
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/${locale}/portal`,
        },
      });
      if (error) throw error;
    } catch (err: Error | unknown) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    }
  };

  // Login alterno por código de email. No sustituye a Google como método
  // principal recomendado -- RBAC lo sigue controlando resolveStaffLogin()
  // (src/lib/staff-login.ts) independientemente del método de login, así
  // que autenticarse por código no da acceso por sí solo: solo entra quien
  // ya esté en employees o admin_roles.
  const handleEmailOtpRequest = async () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
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
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/${locale}/portal`,
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
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : "Failed to send verification code");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length < 6) {
      setError("Please enter the 6-digit code");
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
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : "Invalid verification code");
      setIsLoading(false);
    }
  };

  // Login con código de respaldo (backup code), para cuando el owner_admin
  // no puede usar Google. Ver comentario extenso en
  // src/app/api/admin/backup-codes/verify/route.ts sobre cómo se crea la
  // sesión: ese endpoint valida el código (server-side, service role),
  // marca el código como usado, y devuelve un token_hash de un magic-link
  // nativo de Supabase generado para el email del dueño del código. Este
  // handler solo hace el paso final -- canjear ese token_hash con el método
  // público del SDK -- exactamente igual que un link de email real, salvo
  // que el token llegó por esta respuesta en vez de por correo.
  const handleBackupCodeSignIn = async () => {
    if (!backupCode.trim()) {
      setError("Please enter a backup code");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/backup-codes/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: backupCode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Invalid backup code");

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: json.tokenHash,
        type: "magiclink",
      });
      if (verifyError) throw verifyError;
      window.location.reload();
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : "Backup code sign-in failed");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center space-y-6">
        <div className="w-12 h-12 bg-brand-navy/10 rounded-full flex items-center justify-center mx-auto">
          <Shield className="w-6 h-6 text-brand-navy" />
        </div>
        <h1 className="text-xl font-bold text-brand-ink">Portal de equipo</h1>
        <p className="text-sm text-gray-500">
          Empleados, coordinadores, QC y manager inician sesión aquí con su cuenta de Google de trabajo.
        </p>

        {mode === "google" && (
          <>
            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              aria-label="Iniciar sesión con Google"
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
                  Iniciar sesión con Google
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
              Otras opciones de acceso
            </button>
          </>
        )}

        {mode === "options" && (
          <>
            <button
              onClick={() => setMode("email")}
              className="w-full text-sm text-brand-wave-blue hover:underline"
            >
              Use email verification code instead
            </button>
            <button
              onClick={() => setMode("backup-code")}
              className="w-full text-sm text-gray-500 hover:text-gray-700 hover:underline"
            >
              Can&apos;t use Google? Sign in with a backup code
            </button>
            <button
              onClick={() => setMode("google")}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
          </>
        )}

        {mode === "backup-code" && (
          <div className="space-y-3 text-left">
            <div>
              <label htmlFor="staff-login-backup-code" className="block text-sm font-medium text-brand-ink mb-1">
                Backup Code
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Only for owner_admin. Enter one of the single-use codes generated in
                Admin → Seguridad. Each code works once.
              </p>
              <input
                id="staff-login-backup-code"
                type="text"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center tracking-widest"
              />
            </div>
            <button
              onClick={handleBackupCodeSignIn}
              disabled={isLoading}
              aria-label={isLoading ? "Verifying backup code" : "Sign in with backup code"}
              className="w-full bg-brand-navy text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {isLoading ? "Verifying..." : "Sign In With Backup Code"}
            </button>
            <button
              onClick={() => {
                setMode("options");
                setBackupCode("");
                setError("");
              }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
          </div>
        )}

        {mode === "email" && !otpSent && (
          <div className="space-y-3 text-left">
            <div>
              <label htmlFor="staff-login-email" className="block text-sm font-medium text-brand-ink mb-1">
                Email Address
              </label>
              <input
                id="staff-login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
              />
            </div>
            <button
              onClick={handleEmailOtpRequest}
              disabled={isLoading}
              aria-label={isLoading ? "Enviando código de verificación" : "Enviar código de verificación"}
              className="w-full bg-brand-navy text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
            >
              {isLoading ? "Sending..." : "Send Verification Code"}
            </button>
            <button
              onClick={() => setMode("options")}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
          </div>
        )}

        {mode === "email" && otpSent && (
          <div className="space-y-3 text-left">
            <p className="text-sm text-brand-ink">
              We sent a sign-in link to <strong>{email}</strong>. Open your
              email and click the link to continue — this page will update
              automatically once you&apos;re signed in.
            </p>
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-700">
                Got a 6-digit code instead of a link?
              </summary>
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  aria-label="Código de verificación de 6 dígitos"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center text-lg tracking-widest"
                />
                <button
                  onClick={handleVerifyOtp}
                  disabled={isLoading}
                  aria-label={isLoading ? "Verificando código" : "Verificar código e iniciar sesión"}
                  className="w-full bg-brand-navy text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : "Verify & Sign In"}
                </button>
              </div>
            </details>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>
        )}
        <p className="text-xs text-gray-400">
          Este acceso es solo para personal previamente registrado por el manager.
          Si eres cliente, usa el botón &quot;Iniciar sesión&quot; en la página principal.
        </p>
      </div>
    </div>
  );
}
