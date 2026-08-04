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
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AuthModal } from "@/components/cotizador/AuthModal";
import { CuentaNav } from "@/components/cuenta/CuentaNav";

// Fix (auditoría UX/seguridad 2026-07-30, BUG 3): antes `authenticated` e
// `isStaff` eran dos booleans separados que se resolvían en momentos
// distintos (ver checkSession/onAuthStateChange más abajo) -- entre
// setAuthenticated(true) y el setIsStaff(staff) que llega después, había una
// ventana de render donde authenticated=true / isStaff=false todavía, y el
// layout ya pintaba <CuentaNav/> (navegación de cliente) para una cuenta de
// staff, un instante antes de redirigir a /portal. Un solo status
// consolidado nunca pasa por un estado intermedio "autenticado pero tipo
// desconocido": se actualiza en un solo setStatus() una vez que YA se sabe
// si es cliente o staff.
type AccountStatus = "loading" | "client" | "staff" | "unauthenticated";

export default function CuentaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const t = useTranslations("cuenta.layout");
  const [status, setStatus] = useState<AccountStatus>("loading");

  async function checkStaffStatus() {
    try {
      const res = await fetch("/api/account/access-check", { credentials: "include" });
      if (!res.ok) {
        // Fix (auditoría 2026-07-31): antes CUALQUIER !res.ok (blip de red,
        // timeout, error 500 real) caía en el mismo fail-open de abajo. Pero
        // /api/account/access-check ahora responde 500 + { isStaff: null }
        // específicamente cuando falta SUPABASE_SERVICE_ROLE_KEY en el
        // servidor -- un problema de configuración, no un blip transitorio --
        // y en ESE caso el endpoint fue arreglado a propósito para fallar
        // cerrado (ver comentario en access-check/route.ts). Si el fail-open
        // de acá siguiera aplicando también a esa respuesta, el fix del
        // servidor no serviría de nada: un empleado o admin real seguiría
        // viendo el portal de cliente. Se distingue explícitamente ese caso
        // (isStaff === null en el body) para SÍ tratarlo como staff; el resto
        // de fallos (red, parseo, etc.) sigue siendo fail-open como hasta
        // ahora, mismo criterio documentado en el catch de abajo.
        try {
          const data = await res.json();
          if (data && data.isStaff === null) return true;
        } catch {
          // No se pudo leer el body -- cae al fail-open genérico.
        }
        return false;
      }
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
        setStatus("unauthenticated");
        return;
      }
      const staff = await checkStaffStatus();
      if (cancelled) return;
      setStatus(staff ? "staff" : "client");
    }

    checkSession();

    // v8.3 fix: si el usuario se autentica en otra pestaña/redirect de
    // OAuth (/auth/callback) y vuelve a esta, onAuthStateChange refleja el
    // cambio sin necesitar un refresh manual.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!session?.user) {
        setStatus("unauthenticated");
        return;
      }
      checkStaffStatus().then((staff) => {
        if (cancelled) return;
        setStatus(staff ? "staff" : "client");
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
        setStatus("unauthenticated");
        return;
      }
      const staff = await checkStaffStatus();
      setStatus(staff ? "staff" : "client");
    });
  };

  // Fix (auditoría UX/seguridad 2026-07-30, BUG 3, escenario A): antes un
  // empleado que entraba a /cuenta veía el spinner de carga y de repente
  // estaba en /portal, sin ninguna explicación de por qué. Se muestra un
  // aviso localizado breve antes de redirigir, en vez de un router.replace()
  // instantáneo y silencioso.
  useEffect(() => {
    if (status !== "staff") return;
    const timer = setTimeout(() => {
      router.replace(`/${locale}/portal`);
    }, 1800);
    return () => clearTimeout(timer);
  }, [status, router, locale]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
      </div>
    );
  }

  if (status === "unauthenticated") {
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

  if (status === "staff") {
    // Fix (item 5): una cuenta de empleado/admin autenticada no debe ver el
    // área de cliente -- se manda al Portal de equipo, que resuelve su
    // destino real (empleado/admin/qc). El redirect real ocurre en el
    // useEffect de arriba, después de un breve aviso (BUG 3, escenario A).
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4 text-center px-4">
        <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
        <p className="text-sm text-brand-ink">{t("redirectingToStaffPortal")}</p>
      </div>
    );
  }

  // status === "client": único caso en que se renderiza CuentaNav (BUG 3,
  // escenario B) -- nunca durante "loading" o antes de saber si es staff.
  return (
    <>
      <CuentaNav />
      {children}
    </>
  );
}
