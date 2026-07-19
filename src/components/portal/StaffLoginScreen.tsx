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
 * owner_admin). Solo hace una cosa: autenticar con Google y mandar al
 * usuario a /auth/callback?next=/{locale}/portal, donde la página server
 * ejecuta el lookup real (src/app/api/staff/resolve-login/route.ts) contra
 * employees + admin_roles y decide a dónde va cada quien -- este componente
 * NUNCA decide autorización por sí mismo.
 */
export default function StaffLoginScreen({ locale, error: initialError }: StaffLoginScreenProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(initialError || "");

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
