import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ORDER_CLIENT_COLUMNS } from "@/lib/client-visible-columns";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { isValidUuid } from "@/lib/validation";
import { requireClientCaller } from "@/lib/require-client-caller";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, secure: true, sameSite: "lax" });
      },
    },
  });
}

const MAX_GALLERY_PHOTOS = 5;

/**
 * GET /api/client/orders/[orderId]/gallery
 *
 * v8.3 E5.5 — Galería post-servicio del cliente: 3-5 mejores fotos,
 * checklist visual, duración real, nota del líder, mensaje de cobro de las
 * 7PM. Reutiliza ORDER_CLIENT_COLUMNS (nunca expone score/N/HHE, B.2.3),
 * service_checklist_items (ya legible por el cliente desde la migración
 * 138) y service_logs (nueva policy, migración 155) SOLO para
 * event_type IN ('t_in','t_out','note') -- nunca se piden location_lat/lng
 * (GPS del empleado, invariante B.2.17: GPS del vehículo, no de la persona).
 *
 * Estado vacío definido (D.8): si el servicio aún no está completo, o no
 * tiene fotos, la respuesta incluye `emptyReason` explícito en vez de una
 * galería rota.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  const { orderId } = await params;

  if (!isValidUuid(orderId)) {
    return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(ORDER_CLIENT_COLUMNS)
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (orderError) {
    console.error("orderError:", orderError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

  if (order.status !== "completed") {
    return NextResponse.json(
      {
        order,
        emptyReason: "not_completed",
        message: "Este servicio aún no ha terminado. La galería estará disponible al completarse.",
      },
      { status: 200 }
    );
  }

  const { data: checklistItems, error: checklistError } = await supabase
    .from("service_checklist_items")
    .select("id, item_label, is_completed, photo_url, notes, sop_checklists(zone, zone_label)")
    .eq("order_id", orderId);
  if (checklistError) {
    console.error("checklistError:", checklistError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  const { data: logs, error: logsError } = await supabase
    .from("service_logs")
    .select("event_type, timestamp, notes")
    .eq("order_id", orderId)
    .in("event_type", ["t_in", "t_out", "note"])
    .order("timestamp", { ascending: true });
  if (logsError) {
    console.error("logsError:", logsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  const tIn = (logs || []).find((l) => l.event_type === "t_in")?.timestamp ?? null;
  const tOut = (logs || []).find((l) => l.event_type === "t_out")?.timestamp ?? null;
  const durationMinutes =
    tIn && tOut ? Math.round((new Date(tOut).getTime() - new Date(tIn).getTime()) / 60000) : null;

  const leaderNote = (logs || []).find((l) => l.event_type === "note" && l.notes)?.notes ?? null;

  type ChecklistRow = {
    id: string;
    item_label: string;
    is_completed: boolean;
    photo_url: string | null;
    notes: string | null;
    sop_checklists: { zone: string; zone_label: string } | { zone: string; zone_label: string }[] | null;
  };

  const checklistByZone = new Map<string, { zoneLabel: string; items: { label: string; completed: boolean; photoUrl: string | null }[] }>();
  for (const row of (checklistItems || []) as ChecklistRow[]) {
    const sop = Array.isArray(row.sop_checklists) ? row.sop_checklists[0] : row.sop_checklists;
    const zoneKey = sop?.zone ?? "other";
    const zoneLabel = sop?.zone_label ?? "Other";
    if (!checklistByZone.has(zoneKey)) {
      checklistByZone.set(zoneKey, { zoneLabel, items: [] });
    }
    checklistByZone.get(zoneKey)!.items.push({
      label: row.item_label,
      completed: row.is_completed,
      photoUrl: row.photo_url,
    });
  }

  const allPhotos = (checklistItems || [])
    .filter((c) => c.photo_url)
    .map((c) => c.photo_url as string);
  const galleryPhotos = allPhotos.slice(0, MAX_GALLERY_PHOTOS);

  if (galleryPhotos.length === 0) {
    return NextResponse.json(
      {
        order,
        emptyReason: "no_photos",
        message: "Su servicio se completó, pero aún no hay fotos disponibles. Disculpe el inconveniente.",
        checklist: Array.from(checklistByZone.entries()).map(([zone, v]) => ({ zone, ...v })),
        durationMinutes,
        leaderNote,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      order,
      photos: galleryPhotos,
      checklist: Array.from(checklistByZone.entries()).map(([zone, v]) => ({ zone, ...v })),
      durationMinutes,
      leaderNote,
      billingMessage:
        "Su pago se procesa hoy a las 7:00 PM. ¿Algo no coincide con las fotos de cierre? Repórtelo — revisamos cada caso contra la evidencia.",
    },
    { status: 200 }
  );
}
