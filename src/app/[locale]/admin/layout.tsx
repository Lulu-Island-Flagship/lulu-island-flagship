import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import AdminNav from "@/components/admin/AdminNav";
import AdminBreadcrumbs from "@/components/admin/AdminBreadcrumbs";
import type { AdminRole } from "@/lib/admin-rbac";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

// Título base de las ~70 páginas de /admin: cada page.tsx solo necesita
// exportar `export const metadata = { title: "..." }` con un título corto
// (ej. "Dispatch") y este template lo envuelve en "Dispatch | Lulu Island
// Admin" para la pestaña del navegador. Páginas sin metadata propio caen al
// `default` de abajo en vez de quedar sin título.
export const metadata: Metadata = {
  title: {
    template: "%s | Lulu Island Admin",
    default: "Lulu Island Admin",
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // v8.3 E0 (2026-07-11): Server Components (a diferencia de Route
        // Handlers/Server Actions) NO pueden escribir cookies en Next.js —
        // truena con "Cookies can only be modified in a Server Action or
        // Route Handler" en cuanto Supabase intenta refrescar el token acá.
        // Patrón oficial de @supabase/ssr para este caso: ignorar el error
        // en el Server Component: el refresh real de todos modos requiere
        // middleware de sesión (ver hallazgo de la 2da auditoría — no
        // implementado aún). Sin este try/catch, cualquier página de admin
        // truena en cuanto el token necesita refrescarse.
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // No-op: esperado en Server Components, ver comentario arriba.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // No-op: esperado en Server Components, ver comentario arriba.
          }
        },
      },
    }
  );

  // Detect locale from request headers early (needed for both auth error and nav)
  const headersList = headers();
  const pathname = headersList.get("x-invoke-path") || headersList.get("x-pathname") || "/en/admin";
  const locale = pathname.split("/")[1] || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
  const t = await getTranslations({ locale: safeLocale, namespace: "admin.layout" });
  const tNav = await getTranslations({ locale: safeLocale, namespace: "admin.nav" });

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // v8.3 fix G-1: colapsa las 3 puertas de entrada de staff en una sola
    // (/portal, ver StaffLoginScreen.tsx). Antes este layout renderizaba su
    // propio AdminLoginScreen con redirectTo hardcodeado a /admin -- ahora
    // solo redirige al login unificado, que resuelve el destino real
    // (empleado/admin/qc) contra employees + admin_roles vía
    // /api/staff/resolve-login, sin importar por qué puerta entró el
    // usuario.
    //
    // Fix 2026-07-24 (auditoría externa, M-1 parcial): portal/page.tsx ya
    // honra `next=` desde el fix M-1 original, pero este layout seguía
    // mandando siempre `next=/${safeLocale}/admin` (el área genérica) en vez
    // de la subruta real que el usuario pidió -- un admin que abría
    // /admin/nomina sin sesión terminaba en /admin a secas, no en /nomina,
    // aunque el pathname real (leído arriba de x-invoke-path/x-pathname) ya
    // estaba disponible. Ahora se preserva.
    const safePathname = pathname && pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : `/${safeLocale}/admin`;
    redirect(`/${safeLocale}/portal?next=${encodeURIComponent(safePathname)}`);
  }

  // v8.3 E0 (2026-07-11): hallazgo de auditoría externa (verificado y
  // confirmado real antes de aplicarlo): is_supervisor() solo cubre
  // employees.role='supervisor' activo O admin_roles en ['owner_admin',
  // 'ops_coordinator'] -- NO incluye 'qc_only'. Un usuario con
  // admin_roles.role='qc_only' (rol legítimo, ver el CHECK constraint de la
  // tabla) quedaba bloqueado del layout entero aunque tuviera una fila
  // activa real en admin_roles. El gate correcto es: is_supervisor() O
  // cualquier fila activa en admin_roles, sin importar cuál rol.
  const { data: isSupervisor } = await supabase.rpc("is_supervisor", { user_uuid: user.id });

  // v8.3 fix G-4: antes esta query solo confirmaba EXISTENCIA de alguna fila
  // en admin_roles (select("role").limit(1)) para decidir sí/no acceso, y
  // nunca le pasaba los roles concretos a AdminNav -- por eso el nav
  // renderizaba TODOS los links sin importar el rol real (un qc_only veía el
  // menú completo de un owner_admin). Ahora se trae la lista completa de
  // roles del usuario para filtrar el nav con la misma matriz RBAC que ya
  // protege las APIs (ver src/lib/admin-rbac.ts, roleAllows/allowedResources).
  const { data: roleRows } = await supabase
    .from("admin_roles")
    .select("role")
    .eq("user_id", user.id)
    .is("deleted_at", null);

  const adminRoles = (roleRows ?? []).map((r) => r.role as AdminRole);
  const hasAdminAccess = !!isSupervisor || adminRoles.length > 0;

  // Fix Kimi-A1 (auditoría externa Kimi Code, 2026-07-21, verificado y
  // confirmado real): este fallback ("is_supervisor() sin fila en
  // admin_roles -> tratar como ops_coordinator") hacía que AdminNav
  // mostrara enlaces operativos que requireAdminRole() (src/lib/admin.ts)
  // YA HABÍA DEJADO de conceder sin fila explícita (fix de seguridad v8.3
  // E0 2026-07-11, "riesgo de acceso fantasma") -- el usuario veía el
  // enlace y al hacer clic recibía 403 sin explicación. Se elimina el
  // fallback: un supervisor de campo sin admin_roles sigue entrando al
  // layout (hasAdminAccess arriba ya lo permite vía is_supervisor()) pero
  // ve el nav vacío hasta que un owner_admin le asigne un rol real --
  // exactamente el comportamiento que requireAdminRole() ya documenta como
  // intencional (ver comentario en admin.ts).

  if (!hasAdminAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-bold text-brand-ink">{t("accessTitle")}</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left text-sm space-y-2">
            <p><strong>{t("accessStatus")}</strong> {t("accessNotAuthorized")}</p>
            <p><strong>{t("accessUserEmail")}</strong> {user.email || t("accessNoEmail")}</p>
          </div>
          <p className="text-sm text-gray-500">
            {t("accessDenied")}
          </p>
          <Link
            href={`/${safeLocale}`}
            className="inline-block bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            {t("goHome")}
          </Link>
        </div>
      </div>
    );
  }

  const adminPath = `/${safeLocale}/admin`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Skip link para usuarios de teclado/lector de pantalla — visualmente
          oculto hasta recibir foco (mismo patrón sr-only que ya usa
          src/app/[locale]/page.tsx), salta el nav admin e ir directo al
          contenido principal (#admin-main-content). */}
      <a
        href="#admin-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-white focus:text-brand-ink focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-elevation-2 focus:outline focus:outline-2 focus:outline-brand-navy"
      >
        {t("skipToContent")}
      </a>
      {/* Admin Nav — v8.3 E0: reemplazado el 2026-07-11 por feedback directo
          (notas a mano): la fila plana de 19 links era "muy desordenada".
          Ahora es un menú agrupado por categoría (desktop: dropdowns,
          mobile: acordeón con botón hamburguesa). Ver AdminNav.tsx. */}
      <nav className="bg-brand-navy text-white relative">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href={adminPath} className="font-bold text-lg shrink-0">{tNav("brand")}</Link>
            <AdminNav adminPath={adminPath} roles={adminRoles} />
          </div>
          {/* v8.3 fix M-8: se pasa el locale actual como query param para que
              /auth/signout pueda redirigir de vuelta al idioma correcto en
              vez de caer siempre a "/" (ver src/app/auth/signout/route.ts). */}
          <form action={`/auth/signout?locale=${safeLocale}`} method="post">
            <button type="submit" className="text-sm text-white/70 hover:text-white transition-colors shrink-0">
              {tNav("signOut")}
            </button>
          </form>
        </div>
      </nav>
      <main id="admin-main-content" className="max-w-6xl mx-auto px-4 py-6">
        {/* Montado a nivel de layout para cubrir las ~70 rutas de /admin sin
            tocar cada page.tsx individualmente. */}
        <AdminBreadcrumbs adminPath={adminPath} />
        {children}
      </main>
    </div>
  );
}
