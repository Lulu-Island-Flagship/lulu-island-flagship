"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import StaffLoginScreen from "@/components/portal/StaffLoginScreen";

type Phase = "checking" | "resolving" | "login" | "rejected";

/**
 * v8.3 — /portal: entrada única del "Portal de equipo" (empleado,
 * ops_coordinator, qc_only, owner_admin). Ver src/lib/staff-login.ts para la
 * lógica de autorización real (vive en el servidor, en
 * /api/staff/resolve-login) -- esta página solo orquesta el flujo visual:
 * sin sesión -> StaffLoginScreen; con sesión -> pedir el veredicto al
 * servidor y redirigir, o mostrar el rechazo (nunca crea nada por su cuenta).
 */
export default function PortalPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-navy" />
        </main>
      }
    >
      <PortalContent />
    </Suspense>
  );
}

function PortalContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || "en";

  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const authError = searchParams.get("auth_error");
      if (authError) {
        if (!cancelled) {
          setMessage("No se pudo iniciar sesión. Intenta de nuevo.");
          setPhase("login");
        }
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setPhase("login");
        return;
      }

      if (!cancelled) setPhase("resolving");
      try {
        const res = await fetch("/api/staff/resolve-login", {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setMessage(data.error || "Tu cuenta no está autorizada.");
          setPhase("rejected");
          return;
        }

        router.replace(`/${locale}${data.path}`);
      } catch {
        if (!cancelled) {
          setMessage("Error de conexión verificando tu cuenta. Intenta de nuevo.");
          setPhase("rejected");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "checking" || phase === "resolving") {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-brand-navy mx-auto" />
          <p className="text-sm text-gray-500">Verificando tu cuenta…</p>
        </div>
      </main>
    );
  }

  if (phase === "rejected") {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center space-y-4">
          <h1 className="text-xl font-bold text-brand-ink">Portal de equipo</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-state-danger">
            {message}
          </div>
          <button
            onClick={() => {
              setMessage("");
              setPhase("login");
            }}
            className="text-sm text-brand-wave-blue hover:underline"
          >
            Volver a intentar
          </button>
        </div>
      </main>
    );
  }

  return <StaffLoginScreen locale={locale} error={message} />;
}
