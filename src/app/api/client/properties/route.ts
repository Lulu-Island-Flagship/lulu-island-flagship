import { NextRequest, NextResponse } from "next/server";

import { safeErrorResponse } from "@/lib/api-errors";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
async function getCurrentUser(supabase: ReturnType<typeof createRouteSupabaseClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

async function getOrCreateClientProfile(
  supabase: ReturnType<typeof createRouteSupabaseClient>,
  userId: string
): Promise<{ id: string } | null> {
  const { data: existing, error: selectError } = await supabase
    .from("client_profiles")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (existing) return existing as { id: string };
  if (selectError && selectError.code !== "PGRST116") {
    console.error("Error fetching client profile:", selectError);
    return null;
  }

  const { data: created, error: insertError } = await supabase
    .from("client_profiles")
    .insert({ user_id: userId, score: 50, services_count: 0, disputes_count: 0, no_show_count: 0, account_type: "b2c" })
    .select("id")
    .single();

  if (insertError) {
    console.error("Error creating client profile:", insertError);
    return null;
  }

  return created as { id: string } | null;
}

function validatePropertyBody(body: Record<string, unknown>): { valid: false; error: string } | { valid: true } {
  if (!body.address || typeof body.address !== "string" || body.address.trim().length === 0) {
    return { valid: false, error: "Address is required" };
  }
  if (!body.zone || typeof body.zone !== "string" || body.zone.trim().length === 0) {
    return { valid: false, error: "Zone is required" };
  }
  return { valid: true };
}

// v8.3 fix (auditoría seguridad 2026-07-26): postalCode/squareFeet/nickname no
// se validaban en absoluto -- cualquier string/número arbitrario llegaba
// directo a la fila. Se valida FORMA aquí (canadian postal code, rango
// razonable de pies cuadrados, longitud de nickname); es la misma
// comprobación tanto para crear (POST) como para actualizar (PATCH) estos
// campos opcionales.
const CANADIAN_POSTAL_CODE_REGEX = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
const MIN_SQUARE_FEET = 100;
const MAX_SQUARE_FEET = 50000;
const MAX_NICKNAME_LENGTH = 100;

function validateOptionalPropertyFields(
  body: Record<string, unknown>
): { valid: false; error: string } | { valid: true } {
  if (body.postalCode !== undefined && body.postalCode !== null && body.postalCode !== "") {
    if (typeof body.postalCode !== "string" || !CANADIAN_POSTAL_CODE_REGEX.test(body.postalCode.trim())) {
      return { valid: false, error: "postalCode must be a valid Canadian postal code (e.g. A1A 1A1)" };
    }
  }

  if (body.squareFeet !== undefined && body.squareFeet !== null && body.squareFeet !== "") {
    const squareFeetNum = Number(body.squareFeet);
    if (!Number.isFinite(squareFeetNum) || squareFeetNum < MIN_SQUARE_FEET || squareFeetNum > MAX_SQUARE_FEET) {
      return {
        valid: false,
        error: `squareFeet must be a number between ${MIN_SQUARE_FEET} and ${MAX_SQUARE_FEET}`,
      };
    }
  }

  if (body.nickname !== undefined && body.nickname !== null && body.nickname !== "") {
    if (
      typeof body.nickname !== "string" ||
      body.nickname.trim().length === 0 ||
      body.nickname.trim().length > MAX_NICKNAME_LENGTH
    ) {
      return {
        valid: false,
        error: `nickname must be a non-empty string up to ${MAX_NICKNAME_LENGTH} characters`,
      };
    }
  }

  return { valid: true };
}

// GET /api/client/properties — listar propiedades del cliente autenticado
//
// Fix auditoría 2026-07-30 (ver nota histórica que sigue abajo): este GET
// llamaba a getOrCreateClientProfile(), creando una fila en client_profiles
// como efecto secundario de una lectura -- viola la semántica de un GET
// (idempotente, sin escritura) y puede crear perfiles huérfanos (ej. un
// bot/crawler autenticado que solo hace GET nunca debería dejar una fila
// nueva). Se separa: el GET ahora solo LEE -- si no existe client_profiles
// para este usuario, no hay perfil y por lo tanto no puede haber
// propiedades propias, así que se devuelve `properties: []` directo, sin
// insertar nada. La creación real de client_profiles ya ocurre en el punto
// correcto del flujo -- POST /api/quote (getOrCreateClientProfile local a
// ese archivo, se dispara al enviar una cotización, el primer paso real de
// alta de cliente) -- y también queda como respaldo en los métodos de
// escritura de este mismo archivo (POST/PATCH/DELETE de abajo, sin cambios):
// ahí SÍ es correcto crear el perfil on-demand, porque son acciones
// explícitas de escritura del cliente (crear/editar/borrar una propiedad),
// no una lectura pasiva.
//
// Nota histórica (auditoría seguridad 2026-07-26): la creación implícita
// existía porque varias pantallas de "Mi Cuenta" listan propiedades apenas
// el usuario inicia sesión, sin garantía de que el profile ya exista en ese
// momento. Verificado que esto ya no es un problema real: /api/quote ya
// tiene su propio getOrCreateClientProfile() y se ejecuta en el primer paso
// real de conversión (enviar cotización), antes de que el usuario pueda
// llegar a una pantalla de cuenta con propiedades que listar.
export async function GET() {
  const supabase = createRouteSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  const { data: profile, error: profileError } = await supabase
    .from("client_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return safeErrorResponse(profileError, 500, "Failed to load client profile");
  }
  if (!profile) {
    return NextResponse.json({ properties: [] }, { status: 200 });
  }

  const { data: properties, error } = await supabase
    .from("client_properties")
    .select("*")
    .eq("client_profile_id", profile.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return safeErrorResponse(error, 500, "Failed to load properties");
  }

  return NextResponse.json({ properties: properties || [] }, { status: 200 });
}

// POST /api/client/properties — crear propiedad
export async function POST(request: NextRequest) {
  const supabase = createRouteSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  try {
    const body = await request.json();
    const validation = validatePropertyBody(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const optionalFieldsValidation = validateOptionalPropertyFields(body);
    if (!optionalFieldsValidation.valid) {
      return NextResponse.json({ error: optionalFieldsValidation.error }, { status: 400 });
    }

    const profile = await getOrCreateClientProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json({ error: "Failed to load client profile" }, { status: 500 });
    }

    const normalizedAddress = String(body.address).trim();
    const normalizedPostalCode = body.postalCode ? String(body.postalCode).trim().toUpperCase() : null;

    // Fix (auditoría 2026-07-31, hallazgo #1): el POST insertaba una
    // propiedad nueva sin comprobar si el cliente ya tenía una activa con
    // la misma dirección -- un doble clic, un reintento tras timeout, o
    // simplemente reenviar el mismo formulario por error creaba
    // duplicados silenciosos. El criterio de "duplicado" es exact-match de
    // address (case-insensitive) + postal_code, no un match parcial: un
    // cliente con dos propiedades legítimas en la misma calle (distinto
    // número) no debe quedar bloqueado -- direcciones distintas siempre son
    // direcciones distintas, aunque compartan calle/zona. Cuando
    // postal_code no viene en ninguna de las dos, se compara solo por
    // address exacto (mejor esfuerzo con el dato disponible).
    let duplicateQuery = supabase
      .from("client_properties")
      .select("id")
      .eq("client_profile_id", profile.id)
      .eq("is_active", true)
      .ilike("address", normalizedAddress);
    duplicateQuery = normalizedPostalCode
      ? duplicateQuery.eq("postal_code", normalizedPostalCode)
      : duplicateQuery.is("postal_code", null);
    const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();

    if (duplicateError) {
      return safeErrorResponse(duplicateError, 500, "Failed to check for duplicate property");
    }
    if (duplicate) {
      return NextResponse.json(
        { error: "You already have a property with this address" },
        { status: 409 }
      );
    }

    const { data: property, error } = await supabase
      .from("client_properties")
      .insert({
        client_profile_id: profile.id,
        nickname: body.nickname ? String(body.nickname) : undefined,
        address: normalizedAddress,
        zone: String(body.zone).trim(),
        postal_code: normalizedPostalCode ?? undefined,
        square_feet: body.squareFeet ? Number(body.squareFeet) : undefined,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return safeErrorResponse(error, 500, "Failed to create property");
    }

    return NextResponse.json({ property }, { status: 201 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err, 500, "Failed to create property");
  }
}

// PATCH /api/client/properties — actualizar propiedad propia
export async function PATCH(request: NextRequest) {
  const supabase = createRouteSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: "Property id is required" }, { status: 400 });
    }
    const optionalFieldsValidation = validateOptionalPropertyFields(updates);
    if (!optionalFieldsValidation.valid) {
      return NextResponse.json({ error: optionalFieldsValidation.error }, { status: 400 });
    }

    const profile = await getOrCreateClientProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json({ error: "Failed to load client profile" }, { status: 500 });
    }

    const updatePayload: Record<string, unknown> = {};
    if (updates.nickname !== undefined) updatePayload.nickname = updates.nickname ? String(updates.nickname) : null;
    if (updates.address !== undefined) updatePayload.address = String(updates.address).trim();
    if (updates.zone !== undefined) updatePayload.zone = String(updates.zone).trim();
    if (updates.postalCode !== undefined) {
      updatePayload.postal_code = updates.postalCode ? String(updates.postalCode).trim().toUpperCase() : null;
    }
    if (updates.squareFeet !== undefined) {
      updatePayload.square_feet = updates.squareFeet ? Number(updates.squareFeet) : null;
    }
    if (updates.isActive !== undefined) updatePayload.is_active = Boolean(updates.isActive);

    // Fix (auditoría 2026-07-31, hallazgo #1): mismo chequeo de duplicados
    // que el POST, aplicado aquí solo cuando la actualización TOCA
    // address o postalCode -- si el cliente no está cambiando la
    // dirección, no hay nada que revalidar. Excluye la propia fila (`id`)
    // de la búsqueda para no bloquear un PATCH que no cambia address
    // (ej. solo actualiza nickname) contra sí misma.
    if (updatePayload.address !== undefined || updatePayload.postal_code !== undefined) {
      const addressToCheck = (updatePayload.address as string | undefined) ?? null;
      if (addressToCheck) {
        const postalCodeToCheck = updatePayload.postal_code !== undefined ? (updatePayload.postal_code as string | null) : null;
        let duplicateQuery = supabase
          .from("client_properties")
          .select("id")
          .eq("client_profile_id", profile.id)
          .eq("is_active", true)
          .neq("id", id)
          .ilike("address", addressToCheck);
        duplicateQuery = postalCodeToCheck
          ? duplicateQuery.eq("postal_code", postalCodeToCheck)
          : duplicateQuery.is("postal_code", null);
        const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();
        if (duplicateError) {
          return safeErrorResponse(duplicateError, 500, "Failed to check for duplicate property");
        }
        if (duplicate) {
          return NextResponse.json(
            { error: "You already have a property with this address" },
            { status: 409 }
          );
        }
      }
    }

    const { data: property, error } = await supabase
      .from("client_properties")
      .update(updatePayload)
      .eq("id", id)
      .eq("client_profile_id", profile.id)
      .select()
      .single();

    if (error) {
      return safeErrorResponse(error, 500, "Failed to update property");
    }

    return NextResponse.json({ property }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err, 500, "Failed to update property");
  }
}

// DELETE /api/client/properties — desactivar (soft delete) propiedad propia
export async function DELETE(request: NextRequest) {
  const supabase = createRouteSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Property id is required" }, { status: 400 });
    }

    const profile = await getOrCreateClientProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json({ error: "Failed to load client profile" }, { status: 500 });
    }

    const { data: property, error } = await supabase
      .from("client_properties")
      .update({ is_active: false })
      .eq("id", id)
      .eq("client_profile_id", profile.id)
      .select()
      .single();

    if (error) {
      return safeErrorResponse(error, 500, "Failed to delete property");
    }

    return NextResponse.json({ property }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err, 500, "Failed to delete property");
  }
}
