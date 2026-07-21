import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/languages";
import { isValidLanguageLevels } from "@/lib/employee-languages";
import { CAREER_LEVEL_ORDER } from "@/lib/career-path";
import { renderTemplate, MissingVariableError } from "@/lib/communications";
import { sendEmail } from "@/lib/email";

// PATCH /api/admin/empleados/[id] — idiomas + nivel de fluidez (C.3),
// promoción manual de nivel de carrera (D.11), y activación de un empleado
// nuevo (isActive). El sistema NUNCA promueve solo (ver migración 136) --
// este PATCH es el único punto de escritura de career_level, siempre una
// decisión explícita del admin.
//
// v8.3 — activación (isActive: true): cuando el manager activa a un
// empleado que estaba is_active=false (invariante ya existente de
// FIX-10/POST /api/admin/empleados: nace inactivo hasta aprobación), este
// endpoint dispara el evento de comunicación 'employee_invited' (catálogo
// communication_events/communication_templates, migración 202) con
// instrucciones para entrar al Portal de equipo (/portal). No usa
// dispatchCommunication (src/lib/send-communication.ts) porque esa función
// asume destinatarios en `profiles` (clientes) -- los empleados guardan su
// email directo en `employees`, así que se renderiza la plantilla y se
// llama a sendEmail() aquí mismo, dejando el mismo rastro en
// communication_log que el resto del sistema.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminRole("employees_admin", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { languages, languageLevels, careerLevel, isActive, sin, bankTransitNumber, bankInstitutionNumber, bankAccountNumber } = body as {
      languages?: unknown;
      languageLevels?: unknown;
      careerLevel?: unknown;
      isActive?: unknown;
      sin?: unknown;
      bankTransitNumber?: unknown;
      bankInstitutionNumber?: unknown;
      bankAccountNumber?: unknown;
    };

    // v8.3 P0-8 (auditoría Fable5, 2026-07-19): SIN/datos bancarios NUNCA se
    // escriben con un UPDATE directo sobre employees -- las 4 columnas
    // sensibles ni siquiera son visibles en el `.select(...)` de este
    // endpoint (ver migración 204: REVOKE SELECT sobre sin_encrypted/
    // banking_details_encrypted para anon/authenticated). Si vienen en el
    // body, se validan aquí (mismo nivel de validación que el resto del
    // endpoint) y se escriben con el RPC set_employee_banking_info(), que
    // vuelve a exigir owner_admin por su cuenta y cifra con pgp_sym_encrypt
    // usando PAYROLL_ENCRYPTION_KEY (variable de entorno de servidor).
    // Los 4 campos son "todo o nada": actualizar SIN sin banking (o
    // viceversa) dejaría la otra mitad en null sobre datos que ya existían
    // -- se exige que vengan juntos si se envía cualquiera de los cuatro.
    const bankingFieldsProvided = [sin, bankTransitNumber, bankInstitutionNumber, bankAccountNumber].some(
      (v) => v !== undefined
    );
    if (bankingFieldsProvided) {
      if (typeof sin !== "string" || !/^[0-9]{9}$/.test(sin)) {
        return NextResponse.json({ error: "sin must be exactly 9 digits" }, { status: 400 });
      }
      if (typeof bankTransitNumber !== "string" || !/^[0-9]{5}$/.test(bankTransitNumber)) {
        return NextResponse.json({ error: "bankTransitNumber must be exactly 5 digits" }, { status: 400 });
      }
      if (typeof bankInstitutionNumber !== "string" || !/^[0-9]{3}$/.test(bankInstitutionNumber)) {
        return NextResponse.json({ error: "bankInstitutionNumber must be exactly 3 digits" }, { status: 400 });
      }
      if (typeof bankAccountNumber !== "string" || !/^[0-9]{7,12}$/.test(bankAccountNumber)) {
        return NextResponse.json({ error: "bankAccountNumber must be 7-12 digits" }, { status: 400 });
      }

      const encryptionKey = process.env.PAYROLL_ENCRYPTION_KEY;
      if (!encryptionKey) {
        return NextResponse.json(
          {
            error:
              "PAYROLL_ENCRYPTION_KEY is not configured on the server. Generate one with `openssl rand -base64 32` and set it as a server-only environment variable before capturing SIN/banking data.",
          },
          { status: 500 }
        );
      }

      const { error: bankingError } = await supabase.rpc("set_employee_banking_info", {
        p_employee_id: params.id,
        p_sin: sin,
        p_bank_transit_number: bankTransitNumber,
        p_bank_institution_number: bankInstitutionNumber,
        p_bank_account_number: bankAccountNumber,
        p_encryption_key: encryptionKey,
      });
      if (bankingError) {
        return NextResponse.json({ error: bankingError.message }, { status: 500 });
      }
    }

    const update: Record<string, unknown> = {};
    let activationRequested = false;

    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") {
        return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
      }
      update.is_active = isActive;
      activationRequested = isActive === true;
    }

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

    // v8.3 P0-8: una llamada que SOLO trae sin/banking (sin languages/
    // careerLevel/isActive) ya hizo su escritura completa arriba vía
    // set_employee_banking_info() -- `update` queda vacío legítimamente en
    // ese caso, no es un "no mandaste nada" real.
    if (Object.keys(update).length === 0 && !bankingFieldsProvided) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // Solo se dispara la invitación cuando REALMENTE hay una transición
    // false -> true (no en cada PATCH que traiga isActive:true de nuevo por
    // idempotencia del cliente admin).
    let wasInactive = false;
    if (activationRequested) {
      const { data: before } = await supabase
        .from("employees")
        .select("is_active")
        .eq("id", params.id)
        .is("deleted_at", null)
        .maybeSingle();
      wasInactive = before ? before.is_active === false : false;
    }

    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("employees")
      .update(update)
      .eq("id", params.id)
      .is("deleted_at", null)
      .select("id, user_id, name, email, role, phone, is_active, day_rate, languages, language_levels, career_level, career_level_since, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    let invitation: { status: string; detail?: string } | null = null;
    if (activationRequested && wasInactive && data.is_active) {
      invitation = await sendEmployeeInvitation(supabase, {
        id: data.user_id || data.id,
        name: data.name,
        email: data.email,
        languages: data.languages,
      });
    }

    return NextResponse.json({ employee: data, invitation }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Renderiza y envía la plantilla 'employee_invited' (migración 202) al
 * empleado recién activado, y deja rastro en communication_log con el mismo
 * esquema que usa dispatchCommunication (src/lib/send-communication.ts) --
 * sin reusar esa función porque asume destinatarios en `profiles`.
 */
async function sendEmployeeInvitation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  employee: { id: string; name: string; email: string; languages: string[] | null }
): Promise<{ status: string; detail?: string }> {
  // v8.3 fix G-6: esta lista usaba ["en","es","zh"], pero src/i18n/config.ts
  // declara locales = ['en', 'zh', 'fr'] -- no existe 'es' como locale de la
  // app, y 'fr' faltaba aquí por completo. Con la lista vieja, un empleado
  // con languages=['fr'] nunca matcheaba nada y el link del correo de
  // invitación podía terminar apuntando a un idioma que ni siquiera es una
  // ruta válida. Ver migración 205 (205_e0_employee_invited_fr_template.sql)
  // para la plantilla 'fr' que hacía falta para que este idioma también
  // tenga contenido que enviar.
  const supportedLanguage = (employee.languages || []).find((l) => ["en", "zh", "fr"].includes(l));
  const language = supportedLanguage || "en";

  const { data: template } = await supabase
    .from("communication_templates")
    .select("subject, body")
    .eq("event_key", "employee_invited")
    .eq("language", language)
    .eq("is_current", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (!template) {
    return { status: "skipped_no_template", detail: `Sin plantilla vigente para 'employee_invited' (${language})` };
  }

  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.luluisland.ca"}/${language}/portal`;
  const vars = {
    employee_name: employee.name,
    employee_email: employee.email,
    portal_url: portalUrl,
  };

  let renderedBody: string;
  let renderedSubject: string | null = null;
  try {
    renderedBody = renderTemplate(template.body, vars);
    if (template.subject) renderedSubject = renderTemplate(template.subject, vars);
  } catch (e) {
    const detail = e instanceof MissingVariableError ? e.message : "Error de renderizado";
    await supabase.from("communication_log").insert({
      order_id: null,
      user_id: employee.id,
      event_key: "employee_invited",
      category: "transactional",
      channel: "email",
      language,
      body_rendered: "",
      status: "failed",
      postponed_reason: detail,
    });
    return { status: "failed", detail };
  }

  const emailResult = await sendEmail({
    toEmail: employee.email,
    subject: renderedSubject || "Welcome to the team",
    body: renderedBody,
  });
  const status: "sent" | "failed" | "queued" =
    emailResult.status === "sent" ? "sent" : emailResult.status === "failed" ? "failed" : "queued";

  await supabase.from("communication_log").insert({
    order_id: null,
    user_id: employee.id,
    event_key: "employee_invited",
    category: "transactional",
    channel: "email",
    language,
    body_rendered: renderedBody,
    status,
    postponed_reason: emailResult.status === "not_configured" ? "Proveedor de email aún no configurado (TODO E6)" : null,
    sent_at: status === "sent" ? new Date().toISOString() : null,
  });

  return { status };
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
