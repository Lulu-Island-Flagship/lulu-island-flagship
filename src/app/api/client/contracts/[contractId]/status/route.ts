import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { getVancouverTodayString } from "@/lib/date-utils";
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

const VALID_ACTIONS = ["pause", "resume", "cancel"] as const;
type Action = (typeof VALID_ACTIONS)[number];

/**
 * PATCH /api/client/contracts/[contractId]/status — { action: "pause" | "resume" | "cancel" }
 *
 * v8.3 fix (auditoría de flujo cliente, 2026-07-15): antes NO existía
 * ningún endpoint (ni cliente ni admin) para pausar o cancelar un
 * service_contracts recurrente -- el único cliente que podía tocar
 * `status` era /api/orders/[orderId]/cancel, que cancela una ORDEN
 * individual, no el contrato recurrente en sí. Un cliente que quería dejar
 * de ser cliente recurrente no tenía ninguna vía de autoservicio; el único
 * recurso era pedirle a alguien del lado operativo que lo hiciera a mano
 * en la base de datos. Esto también dejaba "contratos zombis" que los
 * crons de ajuste IPC y revisión de contrato seguían procesando
 * indefinidamente si el cliente simplemente dejaba de reservar sin que
 * nadie cancelara el contrato.
 *
 * Reglas: solo el dueño del contrato (RLS ya lo exige, migración 022) puede
 * tocarlo. Transiciones válidas: active->paused, paused->active (resume),
 * active|paused->cancelled. cancelled es terminal (no se puede reactivar
 * un contrato cancelado -- debe crear uno nuevo). No se tocan las órdenes
 * individuales ya reservadas -- pausar/cancelar el contrato solo detiene
 * la GENERACIÓN de futuras visitas recurrentes; una orden ya confirmada se
 * cancela aparte vía /api/orders/[orderId]/cancel si corresponde.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { contractId: string } }
) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const action = body.action as Action | undefined;
  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action debe ser uno de: ${VALID_ACTIONS.join(", ")}` }, { status: 400 });
  }

  const { contractId } = params;
  const { data: contract, error: contractError } = await supabase
    .from("service_contracts")
    .select("id, user_id, status")
    .eq("id", contractId)
    .maybeSingle();

  if (contractError) {

    console.error("contractError:", contractError);

    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });

  }
  if (!contract || contract.user_id !== user.id) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const currentStatus = contract.status as "active" | "paused" | "cancelled" | "completed";
  if (currentStatus === "cancelled" || currentStatus === "completed") {
    return NextResponse.json({ error: `Contract is already ${currentStatus}` }, { status: 409 });
  }

  let newStatus: "active" | "paused" | "cancelled";
  if (action === "pause") {
    if (currentStatus !== "active") {
      return NextResponse.json({ error: "Only an active contract can be paused" }, { status: 409 });
    }
    newStatus = "paused";
  } else if (action === "resume") {
    if (currentStatus !== "paused") {
      return NextResponse.json({ error: "Only a paused contract can be resumed" }, { status: 409 });
    }
    newStatus = "active";
  } else {
    newStatus = "cancelled";
  }

  const { data: updated, error: updateError } = await supabase
    .from("service_contracts")
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
      ...(newStatus === "cancelled" ? { end_date: getVancouverTodayString() } : {}),
    })
    .eq("id", contractId)
    .select("id, status")
    .single();

  if (updateError) {

    console.error("updateError:", updateError);

    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });

  }
  return NextResponse.json({ contract: updated }, { status: 200 });
}
