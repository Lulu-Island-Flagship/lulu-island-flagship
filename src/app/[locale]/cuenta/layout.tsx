"use client";

// v8.3 fix (auditoría B-1): ninguna de las 5 páginas de /cuenta (servicios,
// propiedades, billetera, referidos, preferencias) tenía guarda de sesión --
// un cliente sin cuenta que llegaba aquí (p.ej. desde el link "Iniciar
// sesión" del home) solo veía la caja roja "Unauthorized" que cada
// componente cliente pinta cuando /api/client/* devuelve 401. Este layout
// cubre las 5 rutas automáticamente (Next.js App Router: un layout en
// cuenta/ envuelve todos sus segmentos hijos) y muestra el AuthModal real
// (src/components/cotizador/AuthModal.tsx, ya usado en el flujo de
// cotización/reserva) en vez de dejar que cada página golpee el API sin
// sesión.
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AuthModal } from "@/components/cotizador/AuthModal";

export default function CuentaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setAuthenticated(Boolean(data.user));
      setChecking(false);
    }

    checkSession();

    // v8.3 fix: si el usuario se autentica en otra pestaña/redirect de
    // OAuth (/auth/callback) y vuelve a esta, onAuthStateChange refleja el
    // cambio sin necesitar un refresh manual.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setAuthenticated(Boolean(session?.user));
      setChecking(false);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleAuthSuccess = () => {
    // Volver a verificar sesión real (getUser, no solo el evento) antes de
    // dar por buena la autenticación -- mismo patrón que
    // cotizador/page.tsx handleAuthSuccess.
    supabase.auth.getUser().then(({ data }) => {
      setAuthenticated(Boolean(data.user));
    });
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-brand-ice">
        <AuthModal
          onClose={() => {
            // v8.3: en /cuenta no tiene sentido "cerrar" el login sin
            // autenticarse -- no hay contenido detrás que mostrar. Se
            // manda al cliente de vuelta al home en vez de dejar un modal
            // cerrado sobre una pantalla en blanco.
            //
            // v8.3 fix M-9 (auditoría implacable 2026-07-20b): antes esto
            // era window.location.href = "/" -- perdía el locale (un
            // usuario en /fr/cuenta/... terminaba en /en por el default del
            // middleware) y forzaba un full page reload innecesario. Ahora
            // usa router.push() con el locale real (useParams(), mismo
            // patrón que otras páginas del área de cliente/empleado) para
            // una navegación client-side normal.
            router.push(`/${locale}`);
          }}
          onSuccess={handleAuthSuccess}
        />
      </div>
    );
  }

  return <>{children}</>;
}
