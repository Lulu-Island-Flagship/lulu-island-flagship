import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { computeRequestDueAt, isRequestOverdue } from "@/lib/pipeda";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";
import { requireClientCaller } from "@/lib/require-client-caller";

/**
 * GET/POST /api/client/pipeda/request — v8.3 fix E-B5 (auditoría
 * RBAC/compliance 2026-07-21): "el titular no tiene canal para ejercer su
 * derecho: solo un admin con rol `compliance` puede crear la solicitud."
 * Antes de este archivo, `data_subject_requests` solo se podía crear vía
 * POST /api/admin/pipeda/requests (requireAdminRole("compliance")) con
 * `requested_by_admin` -- el cliente no tenía ningún endpoint propio.
 *
 * Este endpoint solo cubre 'access' y 'deletion' (los dos derechos que un
 * cliente ejerce sobre sí mismo sin intervención de un admin para
 * *iniciarlos*). 'correction' se deja fuera a propósito: el flujo de
 * corrección actual (ver admin/pipeda/requests/[id]:11-15) exige que un
 * admin aplique el cambio manualmente en la pantalla de cliente
 * correspondiente, así que su alta también queda en el canal admin.
 *
 * Decisión de RLS documentada: la política de `data_subject_requests`
 * (migración 206:220-223) es `FOR ALL USING (is_supervisor(auth.uid()))`
 * -- ni SELECT ni INSERT están abiertos al propio titular. Bajo el cliente
 * anon+cookies de la sesión del cliente, tanto el INSERT de este POST como
 * el SELECT de este GET afectarían/devolverían 0 filas SIN error (RLS
 * silenciosa), exactamente el patrón de "cumplimiento aparente" que el
 * hallazgo E-B5 describe para el resto del sistema. Por eso ambos usan el
 * cliente de service role (mismo patrón que
 * admin/pipeda/requests/[id]/route.ts:132 y client/pre-review-survey) --
 * la autorización real la da `auth.getUser()` de la sesión del cliente
 * (comprobado primero, siempre), y el service role solo se usa para la
 * operación de datos ya autorizada, nunca para saltarse la identidad del
 * usuario. `client_user_id` SIEMPRE sale de `user.id` de la sesión --
 * nunca del body -- para que un cliente no pueda abrir una solicitud a
 * nombre de otro.
 */

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

function getServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(getSupabaseUrl(), serviceKey);
}

const SELF_SERVICE_REQUEST_TYPES = ["access", "deletion"] as const;
type SelfServiceRequestType = (typeof SELF_SERVICE_REQUEST_TYPES)[number];

/** Una solicitud "abierta" es la que todavía no llegó a un estado final. */
const OPEN_STATUSES = ["pending", "processing"];

export async function GET() {
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

  const serviceClient = getServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "PIPEDA self-service is not configured on this environment (service role missing)" },
      { status: 500 }
    );
  }

  const { data: requests, error } = await serviceClient
    .from("data_subject_requests")
    .select(
      "id, request_type, status, requested_at, due_at, completed_at, correction_details, denial_reason, export_reference, purge_eligible_at, purged_at, created_at"
    )
    .eq("client_user_id", user.id)
    .is("deleted_at", null)
    .order("requested_at", { ascending: false });

  if (error) {
    console.error("Supabase query error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const now = new Date();
  const enriched = (requests || []).map((r) => ({
    ...r,
    overdue: isRequestOverdue(new Date(r.due_at), now, r.status),
  }));

  return NextResponse.json({ requests: enriched }, { status: 200 });
}

export async function POST(request: NextRequest) {
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

  try {
    const body = await request.json();
    const { requestType } = body as { requestType?: string };

    if (!SELF_SERVICE_REQUEST_TYPES.includes(requestType as SelfServiceRequestType)) {
      return NextResponse.json(
        { error: "requestType must be access or deletion" },
        { status: 400 }
      );
    }

    const serviceClient = getServiceClient();
    if (!serviceClient) {
      return NextResponse.json(
        { error: "PIPEDA self-service is not configured on this environment (service role missing)" },
        { status: 500 }
      );
    }

    // Evitar duplicados: no dejar abrir una segunda solicitud del mismo
    // tipo mientras haya una sin resolver para este mismo titular.
    const { data: existingOpen, error: existingError } = await serviceClient
      .from("data_subject_requests")
      .select("id, status")
      .eq("client_user_id", user.id)
      .eq("request_type", requestType)
      .in("status", OPEN_STATUSES)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingError) {
      console.error("existingError:", existingError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (existingOpen) {
      return NextResponse.json(
        { error: `You already have an open ${requestType} request (status: ${existingOpen.status}).` },
        { status: 409 }
      );
    }

    const requestedAt = new Date();
    const dueAt = computeRequestDueAt(requestedAt);

    const { data: created, error } = await serviceClient
      .from("data_subject_requests")
      .insert({
        client_user_id: user.id,
        request_type: requestType,
        status: "pending",
        requested_at: requestedAt.toISOString(),
        due_at: dueAt.toISOString(),
        requested_by_admin: null, // self-service: nadie lo pidió por el cliente
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}
