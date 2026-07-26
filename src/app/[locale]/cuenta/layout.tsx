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
import { CuentaNav } from "@/components/cuenta/CuentaNav";

export default function CuentaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  // Fix (auditoría de autenticación 2026-07-25/26, item 5): antes solo se
  // verificaba Boolean(data.user) -- un empleado o admin autenticado veía el
  // layout de cliente igual que un cliente real. isStaff distingue ese caso
  // vía /api/cuenta/access-check (resolveStaffLogin del lado del servidor,
  // ver ese archivo para el detalle -- este layout, siendo Client Component,
  // no puede leer employees/admin_roles directamente por RLS).
  const [isStaff, setIsStaff] = useState(false);

  async function checkStaffStatus() {
    try {
      const res = await fetch("/api/cuenta/access-check", { credentials: "include" });
      if (!res.ok) return false;
      const data = await res.json();
      return Boolean(data.isStaff);
    } catch {
      // Fail-safe: si el chequeo falla (red, etc.), no se bloquea al
      // cliente legítimo -- mismo criterio que ya usa el endpoint.
      return false;
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        setAuthenticated(false);
        setChecking(false);
        return;
      }
      const staff = await checkStaffStatus();
      if (cancelled) return;
      setIsStaff(staff);
      setAuthenticated(true);
      setChecking(false);
    }

    checkSession();

    // v8.3 fix: si el usuario se autentica en otra pestaña/redirect de
    // OAuth (/auth/callback) y vuelve a esta, onAuthStateChange refleja el
    // cambio sin necesitar un refresh manual.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!session?.user) {
        setAuthenticated(false);
        setIsStaff(false);
        setChecking(false);
        return;
      }
      checkStaffStatus().then((staff) => {
        if (cancelled) return;
        setIsStaff(staff);
        setAuthenticated(true);
        setChecking(false);
      });
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAuthSuccess = () => {
    // Volver a verificar sesión real (getUser, no solo el evento) antes de
    // dar por buena la autenticación -- mismo patrón que
    // cotizador/page.tsx handleAuthSuccess. También revalida isStaff, por si
    // la cuenta recién autenticada resulta ser de empleado/admin.
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setAuthenticated(false);
        return;
      }
      const staff = await checkStaffStatus();
      setIsStaff(staff);
      setAuthenticated(true);
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

  if (isStaff) {
    // Fix (item 5): una cuenta de empleado/admin autenticada no debe ver el
    // área de cliente -- se manda al Portal de equipo, que resuelve su
    // destino real (empleado/admin/qc).
    router.replace(`/${locale}/portal`);
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
      </div>
    );
  }

  return (
    <>
      <CuentaNav />
      {children}
    </>
  );
}
