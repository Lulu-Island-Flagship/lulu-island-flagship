import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/languages";
import { isValidLanguageLevels } from "@/lib/employee-languages";
import { CAREER_LEVEL_ORDER } from "@/lib/career-path";

// PATCH /api/admin/empleados/[id] — idiomas + nivel de fluidez (C.3) y
// promoción manual de nivel de carrera (D.11). El sistema NUNCA promueve
// solo (ver migración 136) -- este PATCH es el único punto de escritura de
// career_level, siempre una decisión explícita del admin.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminRole("employees_admin", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { languages, languageLevels, careerLevel } = body as {
      languages?: unknown;
      languageLevels?: unknown;
      careerLevel?: unknown;
    };

    const update: Record<string, unknown> = {};

    if (careerLevel !== undefined) {
      if (typeof careerLevel !== "string" || !CAREER_LEVEL_ORDER.includes(careerLevel as never)) {
        return NextResponse.json(
          { error: `careerLevel must be one of: ${CAREER_LEVEL_ORDER.join(", ")}` },
          { status: 400 }
        );
      }
      update.career_level = careerLevel;
      update.career_level_since = new Date().toISOString();
    }

    if (languages !== undefined) {
      if (
        !Array.isArray(languages) ||
        languages.length === 0 ||
        languages.some((l) => typeof l !== "string" || !SUPPORTED_LANGUAGE_CODES.includes(l))
      ) {
        return NextResponse.json(
          { error: "languages must be a non-empty array of supported language codes" },
          { status: 400 }
        );
      }
      update.languages = languages;
    }

    if (languageLevels !== undefined) {
      // El nivel solo puede declararse sobre idiomas que quedan (o quedaron)
      // en `languages` -- si ambos vienen en el mismo PATCH, se valida contra
      // el `languages` nuevo; si no, contra el actual en DB.
      const spokenLanguages = Array.isArray(update.languages)
        ? (update.languages as string[])
        : await getCurrentLanguages(supabase, params.id);

      if (!isValidLanguageLevels(languageLevels, spokenLanguages)) {
        return NextResponse.json(
          {
            error:
              "languageLevels must be an object mapping a spoken language code to one of: basic, intermediate, fluent, native",
          },
          { status: 400 }
        );
      }
      update.language_levels = languageLevels;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("employees")
      .update(update)
      .eq("id", params.id)
      .is("deleted_at", null)
      .select("id, name, email, role, phone, is_active, day_rate, languages, language_levels, career_level, career_level_since, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    return NextResponse.json({ employee: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCurrentLanguages(supabase: any, employeeId: string): Promise<string[]> {
  const { data } = await supabase
    .from("employees")
    .select("languages")
    .eq("id", employeeId)
    .single();
  return (data?.languages as string[]) || [];
}
