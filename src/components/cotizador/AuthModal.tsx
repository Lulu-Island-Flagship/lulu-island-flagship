"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Globe, Apple, Mail, Smartphone, X } from "lucide-react";

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
  // v8.3 fix (auditoría 2026-07-15): permite mostrar un error de OAuth
  // devuelto por /auth/callback (antes se perdía silenciosamente).
  initialError?: string;
}

export function AuthModal({ onClose, onSuccess, initialError }: AuthModalProps) {
  const [mode, setMode] = useState<"options" | "email" | "phone">("options");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");

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
      setError(err instanceof Error ? err.message : "Google sign-in failed");
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
      setError(err instanceof Error ? err.message : "Apple sign-in failed");
      setLoading(false);
    }
  };

  const handleEmailOtpRequest = async () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
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
      setError(err instanceof Error ? err.message : "Failed to send verification code");
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneOtpRequest = async () => {
    if (!phone || phone.length < 10) {
      setError("Please enter a valid phone number");
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
      setError(err instanceof Error ? err.message : "Failed to send SMS code");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length < 6) {
      setError("Please enter the 6-digit code");
      return;
    }
    // Validate email/phone is still present
    if (mode === "email" && (!email || !email.includes("@"))) {
      setError("Email is required. Please go back and enter your email.");
      return;
    }
    if (mode === "phone" && (!phone || phone.length < 10)) {
      setError("Phone number is required. Please go back and enter your phone.");
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
      onSuccess();
    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : "Invalid verification code");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-elevation-3 max-w-md w-full p-6 relative">
        <button
          aria-label="Cerrar modal de inicio de sesión"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold text-brand-ink mb-2">
          Sign in to Reserve
        </h2>
        <p className="text-gray-600 text-sm mb-6">
          {/* v8.3 fix (auditoría 2026-07-15): el texto anterior ("All methods
              create the same secure account") era falso -- no existe account
              linking en el código; Google, Apple y email/phone OTP crean
              cuentas SEPARADAS en Supabase Auth por defecto. Un cliente que
              reserva con Google y luego entra con email pierde su historial,
              wallet y cotizaciones previas sin ningún aviso. Se corrige el
              texto para reflejar la realidad y se pide explícitamente usar
              siempre el mismo método. */}
          Please use the same sign-in method every time — switching methods (e.g. Google, then
          email) creates a separate account and you&apos;ll lose access to your history and wallet.
        </p>

        {error && (
          <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {mode === "options" && (
          <div className="space-y-3">
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Globe className="w-5 h-5 text-blue-500" />
              <span className="font-medium">Continue with Google</span>
            </button>

            <button
              onClick={handleAppleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Apple className="w-5 h-5 text-black" />
              <span className="font-medium">Continue with Apple</span>
            </button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">or</span>
              </div>
            </div>

            <button
              onClick={() => setMode("email")}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Mail className="w-5 h-5 text-brand-wave-blue" />
              <span className="font-medium">Email + Verification Code</span>
            </button>

            <button
              onClick={() => setMode("phone")}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Smartphone className="w-5 h-5 text-brand-wave-blue" />
              <span className="font-medium">Phone + SMS Code</span>
            </button>
          </div>
        )}

        {mode === "email" && (
          <div className="space-y-4">
            {!otpSent ? (
              <>
                <div>
                  <label htmlFor="auth-email-input" className="block text-sm font-medium text-brand-ink mb-1">
                    Email Address
                  </label>
                  <input
                    id="auth-email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
                  />
                </div>
                <button
                  aria-label="Enviar código de verificación por correo"
                  onClick={handleEmailOtpRequest}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? "Sending..." : "Send Verification Code"}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="auth-otp-email-input" className="block text-sm font-medium text-brand-ink mb-1">
                    Enter 6-digit code sent to {email}
                  </label>
                  <input
                    id="auth-otp-email-input"
                    type="text"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center text-lg tracking-widest"
                  />
                </div>
                <button
                  aria-label="Verificar código e iniciar sesión"
                  onClick={handleVerifyOtp}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? "Verifying..." : "Verify & Sign In"}
                </button>
                <button
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                  }}
                  className="w-full text-sm text-brand-wave-blue hover:underline"
                >
                  Resend code or use different email
                </button>
              </>
            )}
            <button
              onClick={() => setMode("options")}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back to all options
            </button>
          </div>
        )}

        {mode === "phone" && (
          <div className="space-y-4">
            {!otpSent ? (
              <>
                <div>
                  <label htmlFor="auth-phone-input" className="block text-sm font-medium text-brand-ink mb-1">
                    Phone Number
                  </label>
                  <input
                    id="auth-phone-input"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    placeholder="6041234567"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">BC/Canada numbers only</p>
                </div>
                <button
                  aria-label="Enviar código SMS de verificación"
                  onClick={handlePhoneOtpRequest}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? "Sending..." : "Send SMS Code"}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="auth-otp-phone-input" className="block text-sm font-medium text-brand-ink mb-1">
                    Enter 6-digit code sent to {phone}
                  </label>
                  <input
                    id="auth-otp-phone-input"
                    type="text"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-center text-lg tracking-widest"
                  />
                </div>
                <button
                  aria-label="Verificar código e iniciar sesión"
                  onClick={handleVerifyOtp}
                  disabled={loading}
                  className="w-full bg-brand-navy text-white py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50"
                >
                  {loading ? "Verifying..." : "Verify & Sign In"}
                </button>
                <button
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                  }}
                  className="w-full text-sm text-brand-wave-blue hover:underline"
                >
                  Resend code or use different phone
                </button>
              </>
            )}
            <button
              onClick={() => setMode("options")}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back to all options
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
