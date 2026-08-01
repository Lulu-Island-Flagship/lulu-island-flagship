import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminRole } from "@/lib/admin";
import type { AdminRole } from "@/lib/admin-rbac";

/**
 * v8.3 B-2 (auditoría go-live 2026-07-20) — alta/baja de roles administrativos.
 *
 * Hallazgo: `admin_roles` (owner_admin/ops_coordinator/qc_only, migración
 * 040_e0_admin_rbac.sql) es un sistema de rol totalmente separado de
 * `employees.role` (rol de campo, que sí tiene UI de alta completa en
 * /api/admin/empleados). Antes de este fix, CERO endpoints insertaban o
 * actualizaban admin_roles -- la única forma de nombrar a un manager/
 * coordinador/QC era una fila insertada a mano vía SQL directo en Supabase.
 * Este endpoint cierra ese hueco, reusando el mismo patrón exacto que
 * /api/admin/empleados/route.ts (auth.admin.inviteUserByEmail /
 * listUsers para resolver o crear la cuenta auth.users detrás del email).
 *
 * Usa el resource dedicado "admin_roles_management" (src/lib/admin-rbac.ts),
 * restringido a ["owner_admin"] -- gestionar quién tiene acceso
 * administrativo es de los recursos más sensibles del sistema (puede
 * escalar su propio acceso a finanzas/nómina), así que se registra en
 * admin_action_logs bajo su propio nombre en vez de compartir el de
 * "compliance".
 */

const VALID_ROLES: AdminRole[] = ["owner_admin", "ops_coordinator", "qc_only"];

// Fix (auditoría 2026-07-31, hallazgo confirmado): `!email.includes("@")` dejaba
// pasar strings como "a@b" o "@@@" -- mismo problema ya identificado y arreglado
// en src/components/cotizador/AuthModal.tsx (auditoría externa 2026-07-24).
// Regex simple de formato, no pretende cubrir RFC 5322 completo.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getAdminSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey);
}

// Fix (auditoría externa 2026-07-30, BUG 4): supabase-js (^2.110.0, ver
// package.json) no expone un método admin para buscar un usuario por email
// directamente -- auth.admin.listUsers() solo soporta paginación manual
// (page/perPage, ver node_modules/@supabase/supabase-js referencia
// auth-admin-listusers). Antes se llamaba listUsers() UNA vez sin
// paginar -- en un proyecto con más usuarios que el tamaño de página default
// (50), el email buscado podía estar en una página no traída, y el código
// caía en "usuario no encontrado" aunque la cuenta sí existiera, dejando
// (potencialmente) un admin_roles huérfano si el resto del flujo asumiera
// éxito. Este helper pagina explícitamente hasta encontrar el email o
// agotar las páginas.
const LIST_USERS_PAGE_SIZE = 1000;

async function findAuthUserByEmail(
  adminSupabase: NonNullable<ReturnType<typeof getAdminSupabase>>,
  normalizedEmail: string
) {
  let page = 1;
  // Tope de seguridad para no loopear indefinidamente si Supabase alguna vez
  // devolviera un error transitorio sin marcarlo como `error` -- 500 páginas
  // de 1000 = 500k usuarios, muy por encima de cualquier escala realista de
  // este proyecto.
  const MAX_PAGES = 500;
  while (page <= MAX_PAGES) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });
    if (error) {
      console.error("findAuthUserByEmail listUsers error:", error);
      return null;
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (match) return match;
    if (data.users.length < LIST_USERS_PAGE_SIZE) return null; // última página, no había más
    page++;
  }
  console.error("findAuthUserByEmail: se alcanzó MAX_PAGES sin encontrar el email ni agotar la lista");
  return null;
}

// GET /api/admin/roles — lista roles administrativos activos con email del usuario.
export async function GET() {
  const auth = await requireAdminRole("admin_roles_management");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { data, error } = await auth.supabase
      .from("admin_roles")
      .select("id, user_id, role, granted_by, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("admin_roles fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const rows = data || [];

    // Enriquecer con el email de auth.users vía Auth Admin API (mismo patrón
    // que /api/admin/empleados). Si el service role no está configurado, se
    // devuelven las filas sin email en vez de fallar toda la petición.
    const adminSupabase = getAdminSupabase();
    let roles = rows.map((r) => ({ ...r, email: null as string | null }));

    if (adminSupabase) {
      roles = await Promise.all(
        rows.map(async (r) => {
          try {
            const { data: userData } = await adminSupabase.auth.admin.getUserById(r.user_id);
            return { ...r, email: userData?.user?.email ?? null };
          } catch {
            return { ...r, email: null };
          }
        })
      );
    }

    return NextResponse.json({ roles }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin roles list error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/roles — asigna un rol administrativo a un email.
 *
 * Si el email no tiene cuenta en auth.users todavía, se invita (mismo flujo
 * que el onboarding de empleados). Si ya tiene un rol admin_roles activo con
 * ese mismo rol, se rechaza con 409 (la restricción UNIQUE(user_id, role) de
 * la migración 040 ya lo impediría a nivel DB, pero se valida antes para dar
 * un mensaje claro).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("admin_roles_management", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { email, role } = body as { email?: unknown; role?: unknown };

    if (typeof email !== "string" || !email.trim() || !EMAIL_REGEX.test(email.trim())) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }
    if (typeof role !== "string" || !VALID_ROLES.includes(role as AdminRole)) {
      return NextResponse.json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const adminSupabase = getAdminSupabase();
    if (!adminSupabase) {
      return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
    }

    // Reutilizar la cuenta auth si ya existe; si no, crear e invitar --
    // mismo patrón que POST /api/admin/empleados.
    //
    // Fix (auditoría externa 2026-07-30, BUG 4): antes CUALQUIER inviteError
    // (email ya existe, rate limit de invitaciones, SMTP no configurado,
    // etc.) se trataba como "el usuario ya existe" y disparaba la búsqueda
    // en listUsers() sin más chequeo -- un error real de otro tipo hacía que
    // el endpoint devolviera 500 solo si ADEMÁS no encontraba el email en
    // listUsers(), que además no paginaba (ver findAuthUserByEmail arriba).
    // Ahora se distingue explícitamente el código de conflicto de cuenta
    // existente (AuthApiError.code === "email_exists", ver
    // node_modules/@supabase/auth-js/src/lib/error-codes.ts) de cualquier
    // otro tipo de error, que se reporta directamente en vez de asumir el
    // camino de "usuario existente".
    let targetUserId: string;
    const { data: inviteData, error: inviteError } = await adminSupabase.auth.admin.inviteUserByEmail(
      normalizedEmail
    );

    if (inviteError) {
      const isExistingUserConflict =
        inviteError.code === "email_exists" || /already registered|already exists/i.test(inviteError.message ?? "");

      if (!isExistingUserConflict) {
        console.error("Admin role invite error (not an existing-user conflict):", inviteError);
        return NextResponse.json({ error: "No se pudo invitar al usuario" }, { status: 500 });
      }

      const existingAuthUser = await findAuthUserByEmail(adminSupabase, normalizedEmail);

      if (!existingAuthUser) {
        console.error(
          "Admin role invite error: Supabase reportó email_exists pero no se encontró la cuenta paginando listUsers:",
          inviteError
        );
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      targetUserId = existingAuthUser.id;
    } else {
      targetUserId = inviteData.user.id;
    }

    const { data: existingRole } = await auth.supabase
      .from("admin_roles")
      .select("id")
      .eq("user_id", targetUserId)
      .eq("role", role)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingRole) {
      return NextResponse.json({ error: "This user already has this admin role" }, { status: 409 });
    }

    const { data: newRole, error: insertError } = await auth.supabase
      .from("admin_roles")
      .insert({
        user_id: targetUserId,
        role,
        granted_by: auth.user?.id ?? null,
      })
      .select("id, user_id, role, granted_by, created_at")
      .single();

    if (insertError) {
      console.error("admin/roles error:", insertError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json(
      { role: { ...newRole, email: normalizedEmail }, invited: !inviteError },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin role create error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/roles?id=<admin_roles.id> — revoca un rol administrativo
 * (soft-delete: deleted_at, consistente con el resto del esquema -- la tabla
 * tiene un trigger prevent_hard_delete() que bloquea el DELETE físico).
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminRole("admin_roles_management", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }

    // Fix (auditoría externa, hallazgo confirmado): antes de revocar, si la
    // fila a revocar es un owner_admin, verificar que no sea el último
    // owner_admin activo del sistema -- de lo contrario el sistema queda sin
    // nadie con el rol de máximo privilegio y nadie puede volver a otorgar
    // admin_roles (este mismo endpoint exige "owner_admin" vía
    // requireAdminRole("admin_roles_management")).
    const { data: roleToRevoke, error: fetchError } = await auth.supabase
      .from("admin_roles")
      .select("id, role")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError) {
      console.error("admin_roles fetch-before-revoke error:", fetchError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    if (roleToRevoke?.role === "owner_admin") {
      const { count: ownerAdminCount, error: countError } = await auth.supabase
        .from("admin_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "owner_admin")
        .is("deleted_at", null);

      if (countError) {
        console.error("admin_roles owner_admin count error:", countError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      if ((ownerAdminCount ?? 0) <= 1) {
        return NextResponse.json(
          { error: "No se puede revocar el último owner_admin del sistema" },
          { status: 400 }
        );
      }
    }

    const { data: revoked, error: updateError } = await auth.supabase
      .from("admin_roles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("admin/roles error:", updateError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (!revoked) {
      return NextResponse.json({ error: "Admin role not found or already revoked" }, { status: 404 });
    }

    return NextResponse.json({ revoked: true }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin role revoke error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
