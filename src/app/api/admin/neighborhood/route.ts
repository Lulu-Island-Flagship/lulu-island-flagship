import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  getNoiseWindow,
  shouldNotifyConcierge,
  getAccessProtocol,
  type ZoneType,
  type ConciergeNotifyPreference,
  type BuildingAccessType,
} from "@/lib/neighborhood";

/**
 * GET /api/admin/neighborhood — bitácora de quejas + leads de vecinos, más
 * el cómputo de reglas (getNoiseWindow/shouldNotifyConcierge/getAccessProtocol,
 * src/lib/neighborhood.ts) para cada propiedad con complaint/lead reciente.
 * POST /api/admin/neighborhood:
 *   { action: "log_complaint", clientPropertyId, description }
 *   { action: "log_lead", name, contactPhone?, contactEmail?, sourcePropertyId?, notes? }
 *   { action: "compute_rules", clientPropertyId, clientWillBeAbsent? } — devuelve
 *     ventana de ruido + protocolo de acceso + si hay que notificar concierge,
 *     para esa propiedad específica.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [{ data: complaints, error: complaintsError }, { data: leads, error: leadsError }] = await Promise.all([
    auth.supabase
      .from("neighbor_complaints")
      .select("id, client_property_id, description, created_at, client_properties:client_property_id ( address )")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    auth.supabase
      .from("neighbor_leads")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (complaintsError) return NextResponse.json({ error: complaintsError.message }, { status: 500 });
  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 });

  return NextResponse.json({ complaints: complaints || [], leads: leads || [] }, { status: 200 });
}

interface Body {
  action?: string;
  clientPropertyId?: string;
  description?: string;
  name?: string;
  contactPhone?: string;
  contactEmail?: string;
  sourcePropertyId?: string;
  notes?: string;
  clientWillBeAbsent?: boolean;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (body.action === "log_complaint") {
    if (!body.clientPropertyId || !body.description) {
      return NextResponse.json({ error: "clientPropertyId y description son obligatorios" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("neighbor_complaints")
      .insert({
        client_property_id: body.clientPropertyId,
        description: body.description.trim(),
        reported_by: employeeRow?.id ?? null,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ complaint: data }, { status: 201 });
  }

  if (body.action === "log_lead") {
    if (!body.name) {
      return NextResponse.json({ error: "name es obligatorio" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("neighbor_leads")
      .insert({
        name: body.name.trim(),
        contact_phone: body.contactPhone?.trim() || null,
        contact_email: body.contactEmail?.trim() || null,
        source_property_id: body.sourcePropertyId || null,
        notes: body.notes?.trim() || null,
        reported_by: employeeRow?.id ?? null,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ lead: data }, { status: 201 });
  }

  if (body.action === "compute_rules") {
    if (!body.clientPropertyId) {
      return NextResponse.json({ error: "clientPropertyId es obligatorio" }, { status: 400 });
    }
    const { data: property, error: propertyError } = await supabase
      .from("client_properties")
      .select("zone_type, concierge_notify_preference, building_access_type")
      .eq("id", body.clientPropertyId)
      .single();
    if (propertyError || !property) {
      return NextResponse.json({ error: "Propiedad no encontrada" }, { status: 404 });
    }

    const zoneType = (property.zone_type ?? "residential") as ZoneType;
    const noiseWindow = getNoiseWindow(zoneType);
    const notifyConcierge = shouldNotifyConcierge(
      (property.concierge_notify_preference ?? "never") as ConciergeNotifyPreference,
      body.clientWillBeAbsent === true
    );
    const accessProtocol = property.building_access_type
      ? getAccessProtocol(property.building_access_type as BuildingAccessType)
      : null;

    return NextResponse.json({ noiseWindow, notifyConcierge, accessProtocol }, { status: 200 });
  }

  return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
}
