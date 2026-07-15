import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminRole } from "@/lib/admin";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/languages";

// GET /api/admin/empleados — lista de todos los empleados
export async function GET() {
  const auth = await requireAdminRole("employees_admin");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { data, error } = await auth.supabase
      .from("employees")
      .select("id, name, email, role, phone, is_active, day_rate, languages, language_levels, career_level, created_at")
      .order("name", { ascending: true });

    if (error) {
      console.error("Employees fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ employees: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin employees error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/empleados — FIX-10: onboarding real de un empleado nuevo.
 *
 * v8.3 hallazgo de auditoría: no existía NINGÚN endpoint en todo el sistema
 * que insertara en `employees` -- la única forma de que un empleado
 * existiera era un seed manual o acceso directo a la base de datos. Esto
 * significa que, tal como estaba el sistema, el "primer día" de un empleado
 * real (D.10 #1: onboarding) era técnicamente imposible de ejecutar desde
 * el producto.
 *
 * `employees.user_id` referencia auth.users -- un empleado nuevo típicamente
 * no tiene cuenta de Supabase todavía, así que este endpoint usa
 * supabase.auth.admin.inviteUserByEmail (requiere SUPABASE_SERVICE_ROLE_KEY,
 * mismo patrón que los crons server-to-server, ej. wellbeing-chemical-
 * reassign) para crear la cuenta auth Y enviar la invitación de una vez.
 * Si el email ya tiene una cuenta auth (ej. re-contratación), se reutiliza
 * ese user_id en vez de fallar.
 *
 * Se crea SIEMPRE con is_active=false (invariante: un empleado nuevo no es
 * asignable por dispatch-scheduler hasta que el admin lo active
 * explícitamente tras completar el papeleo/orientación -- mismo criterio
 * que activeEmployees en el cron, que ya filtra por is_active=true).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("employees_admin", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { name, email, phone, role, dayRate, languages, homeZone, hireDate } = body as {
      name?: unknown;
      email?: unknown;
      phone?: unknown;
      role?: unknown;
      dayRate?: unknown;
      languages?: unknown;
      homeZone?: unknown;
      hireDate?: unknown;
    };

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (typeof email !== "string" || !email.trim() || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }
    const validRoles = ["cleaner", "supervisor", "driver"];
    if (typeof role !== "string" || !validRoles.includes(role)) {
      return NextResponse.json({ error: `role must be one of: ${validRoles.join(", ")}` }, { status: 400 });
    }
    if (
      languages !== undefined &&
      (!Array.isArray(languages) ||
        languages.length === 0 ||
        languages.some((l) => typeof l !== "string" || !SUPPORTED_LANGUAGE_CODES.includes(l)))
    ) {
      return NextResponse.json(
        { error: "languages must be a non-empty array of supported language codes" },
        { status: 400 }
      );
    }
    if (dayRate !== undefined && (typeof dayRate !== "number" || dayRate <= 0)) {
      return NextResponse.json({ error: "dayRate must be a positive number" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: existingEmployee } = await auth.supabase
      .from("employees")
      .select("id")
      .eq("email", normalizedEmail)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingEmployee) {
      return NextResponse.json({ error: "An employee with this email already exists" }, { status: 409 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "Supabase service credentials not configured" },
        { status: 500 }
      );
    }
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // Reutilizar la cuenta auth si ya existe (re-contratación); si no, crear
    // e invitar. inviteUserByEmail falla con "already registered" si la
    // cuenta ya existe -- se maneja explícitamente en vez de dejar que la
    // creación completa del onboarding truene por ese caso esperado.
    let authUserId: string;
    const { data: inviteData, error: inviteError } = await adminSupabase.auth.admin.inviteUserByEmail(
      normalizedEmail
    );

    if (inviteError) {
      const { data: existingUsers, error: listError } =
        await adminSupabase.auth.admin.listUsers();
      const existingAuthUser = !listError
        ? existingUsers.users.find((u) => u.email?.toLowerCase() === normalizedEmail)
        : undefined;

      if (!existingAuthUser) {
        console.error("Employee invite error:", inviteError, listError);
        return NextResponse.json({ error: inviteError.message }, { status: 500 });
      }
      authUserId = existingAuthUser.id;
    } else {
      authUserId = inviteData.user.id;
    }

    const { data: employee, error: insertError } = await auth.supabase
      .from("employees")
      .insert({
        user_id: authUserId,
        name: name.trim(),
        email: normalizedEmail,
        phone: typeof phone === "string" ? phone.trim() || null : null,
        role,
        day_rate: typeof dayRate === "number" ? dayRate : 200,
        languages: Array.isArray(languages) ? languages : ["en"],
        home_zone: typeof homeZone === "string" ? homeZone.trim() || null : null,
        hire_date: typeof hireDate === "string" ? hireDate : new Date().toISOString().split("T")[0],
        is_active: false,
      })
      .select("id, name, email, role, phone, is_active, day_rate, languages, home_zone, hire_date, career_level, created_at")
      .single();

    if (insertError) {
      // Si el insert de employees falla después de crear la cuenta auth, no
      // queda huérfana silenciosamente: el mismo email ya existe en auth y un
      // reintento de este endpoint la reutilizará vía el branch de arriba.
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ employee, invited: !inviteError }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin employee create error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
