import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );
}

async function getCurrentUser(supabase: ReturnType<typeof getSupabaseClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

async function getOrCreateClientProfile(
  supabase: ReturnType<typeof getSupabaseClient>,
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

// GET /api/client/properties — listar propiedades del cliente autenticado
export async function GET() {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getOrCreateClientProfile(supabase, user.id);
  if (!profile) {
    return NextResponse.json({ error: "Failed to load client profile" }, { status: 500 });
  }

  const { data: properties, error } = await supabase
    .from("client_properties")
    .select("*")
    .eq("client_profile_id", profile.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Properties fetch error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ properties: properties || [] }, { status: 200 });
}

// POST /api/client/properties — crear propiedad
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const validation = validatePropertyBody(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const profile = await getOrCreateClientProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json({ error: "Failed to load client profile" }, { status: 500 });
    }

    const { data: property, error } = await supabase
      .from("client_properties")
      .insert({
        client_profile_id: profile.id,
        nickname: body.nickname ? String(body.nickname) : undefined,
        address: String(body.address).trim(),
        zone: String(body.zone).trim(),
        postal_code: body.postalCode ? String(body.postalCode).trim().toUpperCase() : undefined,
        square_feet: body.squareFeet ? Number(body.squareFeet) : undefined,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Property insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ property }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/client/properties — actualizar propiedad propia
export async function PATCH(request: NextRequest) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: "Property id is required" }, { status: 400 });
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

    const { data: property, error } = await supabase
      .from("client_properties")
      .update(updatePayload)
      .eq("id", id)
      .eq("client_profile_id", profile.id)
      .select()
      .single();

    if (error) {
      console.error("Property update error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ property }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/client/properties — desactivar (soft delete) propiedad propia
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      console.error("Property delete error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ property }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
