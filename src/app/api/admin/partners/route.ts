import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

const PARTNER_TYPES = ["real_estate_agent", "property_manager", "veterinarian", "builder"];

// GET /api/admin/partners — registro de partners.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("partners")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("admin/partners error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  return NextResponse.json({ partners: data || [] }, { status: 200 });
}

// POST /api/admin/partners — registrar un nuevo partner.
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { partnerType, name, contactEmail, contactPhone, taxIdForT4a, notes } = body;

    if (!partnerType || !PARTNER_TYPES.includes(partnerType)) {
      return NextResponse.json({ error: `partnerType debe ser uno de: ${PARTNER_TYPES.join(", ")}` }, { status: 400 });
    }
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name es obligatorio" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("partners")
      .insert({
        partner_type: partnerType,
        name: name.trim(),
        contact_email: contactEmail?.trim() || null,
        contact_phone: contactPhone?.trim() || null,
        tax_id_for_t4a: taxIdForT4a?.trim() || null,
        notes: notes?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/partners error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ partner: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
