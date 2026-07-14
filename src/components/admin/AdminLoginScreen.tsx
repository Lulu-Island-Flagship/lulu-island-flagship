"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Shield, Loader2 } from "lucide-react";

export default function AdminLoginScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"options" | "email">("options");
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError("");
    try {
      const currentPath = window.location.pathname;
      const locale = currentPath.split("/")[1] || "en";
      const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/${safeLocale}/admin`,
        },
      });
      if (error) throw error;
    } catch (err: Error | unknown) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    }
  };

  // Login alterno por código de email (mismo mecanismo ya usado en
  // src/components/cotizador/AuthModal.tsx). No sustituye a Google como
  // método principal recomendado para admins — RBAC lo sigue controlando
  // requireAdminRole()/admin_roles independientemente del método de login,
  // así que autenticarse por código no da acceso: solo entra a admin_roles
  // quien un owner_admin ya haya autorizado ahí.
  const handleEmailOtpRequest = async () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const currentPath = window.location.pathname;
      const locale = currentPath.split("/")[1] || "en";
      const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
      // emailRedirectTo -> /auth/callback: esta instancia local no tiene
      // customizado el template de email con {{ .Token }}, así que Supabase
      // manda un magic link (no un código de 6 dígitos). El link necesita
      // pasar por /auth/callback para intercambiar el "code" PKCE por una
      // sesión real (mismo mecanismo que ya usa Google arriba) -- sin esto,
      // el link redirige pero nunca crea sesión.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/${safeLocale}/admin`,
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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center space-y-6">
        <div className="w-12 h-12 bg-brand-navy/10 rounded-full flex items-center justify-center mx-auto">
          <Shield className="w-6 h-6 text-brand-navy" />
        </div>
        <h1 className="text-xl font-bold text-brand-ink">Admin Access</h1>
        <p className="text-sm text-gray-500">
          Please sign in to continue
        </p>
        {mode === "options" && (
          <>
            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full bg-white border border-gray-300 text-brand-ink py-2.5 rounded-lg font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
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
                  Sign in with Google
                </>
              )}
            </button>
            <button
              onClick={() => setMode("email")}
              className="w-full text-sm text-brand-wave-blue hover:underline"
            >
              Use email verification code instead
            </button>
          </>
        )}
        {mode === "email" && !otpSent && (
          <div className="space-y-3 text-left">
            <div>
              <label className="block text-sm font-medium text-brand-ink mb-1">
                Email Address
              </label>
              <input
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
            {/* v8.3 E0 (2026-07-11): hallazgo de auditoría externa
                (verificado real): esta pantalla pedía un código de 6
                dígitos como si siempre llegara uno, pero
                signInWithOtp() sin un template de email con {{ .Token }}
                configurado (el default de este proyecto local, ver
                supabase/config.toml) manda un MAGIC LINK, no un código —
                confirmado hoy mismo probando el flujo real contra Mailpit.
                Un usuario nunca recibiría número que escribir y se
                quedaría atascado. Ahora el link es la instrucción
                primaria; el código queda como alterna solo por si el
                proyecto llega a configurar ese template más adelante. */}
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
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center text-lg tracking-widest"
                />
                <button
                  onClick={handleVerifyOtp}
                  disabled={isLoading}
                  className="w-full bg-brand-gold text-brand-navy py-2.5 rounded-lg font-semibold hover:bg-brand-gold-dark transition-colors disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : "Verify & Sign In"}
                </button>
              </div>
            </details>
          </div>
        )}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
