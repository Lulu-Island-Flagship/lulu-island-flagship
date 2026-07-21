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

        // v8.3 fix M-1 (auditoría implacable 2026-07-20b): antes se
        // ignoraba por completo el ?next= original (el que admin/layout.tsx
        // o empleado/page.tsx ponen al mandar aquí, ej.
        // next=/en/admin/nomina) y siempre se redirigía al landing fijo del
        // área (data.path, ver AREA_TO_PATH en
        // src/app/api/staff/resolve-login/route.ts) -- un ops_coordinator
        // que quería volver a /admin/nomina terminaba en /admin sin más.
        //
        // `next` es input controlado por quien arma la URL (query param) --
        // mismo riesgo de open redirect que ya se blindó en
        // src/app/auth/callback/route.ts: solo se acepta una ruta relativa
        // que empiece con "/" y no con "//". Además, y esto es lo que
        // faltaba en el fix ingenuo, `next` solo se honra si su prefijo de
        // área coincide con el área real que el servidor acaba de resolver
        // (data.path) -- si no coincide (ej. un qc_only con
        // next=/en/admin/nomina, cuyo prefijo de área es /admin pero
        // data.path es /admin/qc), se ignora `next` y se cae al landing fijo
        // del área real. Así un qc_only nunca puede usar `next` para llegar
        // a una página de /admin fuera de /admin/qc.
        const rawNext = searchParams.get("next");
        const safeNext =
          rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;
        // safeNext ya viene con el locale incluido (ej. /en/admin/nomina) --
        // el prefijo de área real es todo lo que sigue al segmento de
        // locale, así que se compara ese resto contra data.path
        // ("/admin", "/admin/qc" o "/empleado").
        const nextAreaPath = safeNext
          ? "/" + safeNext.split("/").filter(Boolean).slice(1).join("/")
          : null;
        const isSameArea = nextAreaPath ? nextAreaPath.startsWith(data.path) : false;

        router.replace(isSameArea && safeNext ? safeNext : `/${locale}${data.path}`);
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
    // v8.3 fix M-4: antes las deps eran [] -- si el usuario volvía a
    // /portal con un ?auth_error= distinto (ej. reintenta el login y falla
    // de nuevo) el efecto no se re-evaluaba porque React nunca lo veía como
    // "cambiado". searchParams sí cambia de referencia cuando cambia la
    // query string, así que agregarlo como dep hace que un nuevo
    // auth_error se procese sin necesitar un full reload. router/locale no
    // se agregan: son estables entre renders de esta página y agregarlos no
    // cambia el comportamiento, solo ruido en el array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
