import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import AdminLoginScreen from "@/components/admin/AdminLoginScreen";
import AdminNav from "@/components/admin/AdminNav";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

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

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <AdminLoginScreen />;
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

  let hasAdminAccess = !!isSupervisor;
  if (!hasAdminAccess) {
    const { data: roleRows } = await supabase
      .from("admin_roles")
      .select("role")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .limit(1);
    hasAdminAccess = !!roleRows && roleRows.length > 0;
  }

  if (!hasAdminAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-bold text-brand-ink">Admin Access</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left text-sm space-y-2">
            <p><strong>Status:</strong> Not authorized</p>
            <p><strong>User email:</strong> {user.email || "no email"}</p>
          </div>
          <p className="text-sm text-gray-500">
            Your account does not have an admin role assigned.
          </p>
          <a
            href={`/${safeLocale}`}
            className="inline-block bg-brand-navy text-white px-4 py-2 rounded-lg font-medium"
          >
            Go to Home
          </a>
        </div>
      </div>
    );
  }

  const adminPath = `/${safeLocale}/admin`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Admin Nav — v8.3 E0: reemplazado el 2026-07-11 por feedback directo
          (notas a mano): la fila plana de 19 links era "muy desordenada".
          Ahora es un menú agrupado por categoría (desktop: dropdowns,
          mobile: acordeón con botón hamburguesa). Ver AdminNav.tsx. */}
      <nav className="bg-brand-navy text-white relative">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <a href={adminPath} className="font-bold text-lg shrink-0">Admin</a>
            <AdminNav adminPath={adminPath} />
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm text-white/70 hover:text-white transition-colors shrink-0">
              Sign Out
            </button>
          </form>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
