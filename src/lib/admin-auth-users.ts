import type { User } from "@supabase/supabase-js";
import { captureError } from "@/lib/observability";

/**
 * Fix (build error 2026-08-01): `findAuthUserByEmail` se llama con clientes
 * creados por dos caminos distintos -- `createClient(...)` directo en
 * empleados/route.ts y `getAdminSupabase()` en roles/route.ts (src/lib/admin.ts)
 * -- que tras el bump de @supabase/supabase-js resuelven a instancias de
 * `SupabaseClient<...>` con parámetros de tipo genérico incompatibles entre
 * sí (uno usa la firma nueva con `PostgrestVersion`, el otro no), aunque
 * ambos son, en tiempo de ejecución, el mismo cliente admin. En vez de pelear
 * con esa incompatibilidad de generics, se tipa el parámetro de forma
 * estructural con solo lo que este helper realmente usa.
 */
type AdminAuthClient = {
  auth: {
    admin: {
      listUsers: (opts: { page: number; perPage: number }) => Promise<{
        data: { users: User[] };
        error: { message: string } | null;
      }>;
    };
  };
};

/**
 * Fix (auditoría de integridad de datos 2026-08-01): helpers compartidos
 * para resolver una cuenta de auth.users por email desde endpoints admin
 * (POST /api/admin/empleados y POST /api/admin/roles). Antes cada endpoint
 * tenía su propia copia parcial de esta lógica -- empleados/route.ts se
 * quedó con la versión vieja sin paginar (auth.admin.listUsers() sin
 * page/perPage, default 50 resultados) mientras roles/route.ts ya había
 * sido arreglado. Se centraliza aquí para que ambos usen exactamente el
 * mismo comportamiento correcto.
 */

// Fix (auditoría 2026-07-31, hallazgo confirmado): `!email.includes("@")`
// dejaba pasar strings como "a@b" o "@@@".  Regex simple de formato, no
// pretende cubrir RFC 5322 completo.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fix (auditoría externa 2026-07-30, BUG 4): supabase-js no expone un
// método admin para buscar un usuario por email directamente --
// auth.admin.listUsers() solo soporta paginación manual (page/perPage).
// Antes se llamaba listUsers() UNA vez sin paginar -- en un proyecto con
// más usuarios que el tamaño de página default (50), el email buscado
// podía estar en una página no traída, y el código caía en "usuario no
// encontrado" aunque la cuenta sí existiera. Este helper pagina
// explícitamente hasta encontrar el email o agotar las páginas.
const LIST_USERS_PAGE_SIZE = 1000;
const MAX_PAGES = 500; // 500 páginas de 1000 = 500k usuarios, muy por encima de cualquier escala realista de este proyecto.

export async function findAuthUserByEmail(
  adminSupabase: AdminAuthClient,
  normalizedEmail: string
) {
  let page = 1;
  while (page <= MAX_PAGES) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });
    if (error) {
      captureError(error, { fn: "findAuthUserByEmail.listUsers" });
      return null;
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (match) return match;
    if (data.users.length < LIST_USERS_PAGE_SIZE) return null; // última página, no había más
    page++;
  }
  captureError(new Error("findAuthUserByEmail exhausted MAX_PAGES without match"), { fn: "findAuthUserByEmail" });
  return null;
}
