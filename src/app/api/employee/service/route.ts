import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  evaluateClosureProtocol,
  type ZoneClosureStatus,
  type ExternalConfirmationType,
} from "@/lib/closure-protocol";
import { dispatchCommunication } from "@/lib/send-communication";
import { buildReviewLink, buildReviewQrSvg, hasOpenCriticalDispute } from "@/lib/review-delivery";
import { ensureZoneAssignment } from "@/lib/zone-assignment";
import { haversineDistance, ARRIVAL_GEOFENCE_RADIUS_METERS } from "@/lib/geocode";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getVancouverOffset } from "@/lib/date-utils";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options, httpOnly: true, secure: true, sameSite: "lax" });
        },
      },
    }
  );
}

/**
 * v8.3 E4.11 — Protocolo de Cierre Externo. Junta checklist + implementos +
 * confirmación externa desde Supabase y delega la decisión a la función
 * pura src/lib/closure-protocol.ts. T_out se rechaza si no está completo.
 */
async function checkClosureProtocol(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orderId: string,
  employeeId: string
): Promise<{ complete: boolean; missing: string[] }> {
  // v8.3 E4 fix (13 jul 2026): orders NO tiene columna service_subtype (solo
  // vive en quotes, migración 001). Esta consulta pedía una columna
  // inexistente, PostgREST la rechazaba, `order` quedaba null, y
  // serviceSubtype terminaba en "" — el checklist siempre resolvía a 0
  // zonas y evaluateClosureProtocol bloqueaba T_out con "No hay checklist
  // cargado" para TODOS los servicios, siempre. Se corrige con el join real
  // orders.quote_id -> quotes.service_subtype (mismo patrón que
  // servicio/[orderId]/route.ts).
  const { data: order } = await supabase
    .from("orders")
    .select("quotes:quote_id ( service_subtype )")
    .eq("id", orderId)
    .single();

  const quoteForSubtype = order?.quotes as unknown as { service_subtype?: string } | null;
  const serviceSubtype = quoteForSubtype?.service_subtype;

  const { data: orderForAddons } = await supabase
    .from("orders")
    .select("addon_zones")
    .eq("id", orderId)
    .maybeSingle();
  const selectedAddonZones = new Set<string>(orderForAddons?.addon_zones || []);

  const { data: checklistsRaw } = await supabase
    .from("sop_checklists")
    .select("id, zone, zone_label, items, is_addon_zone")
    .is("deleted_at", null)
    .eq("service_subtype", serviceSubtype || "")
    .eq("is_active", true);

  // v8.3 E4 (D.7): dos filtros antes de exigir la zona en el cierre de ESTE
  // empleado — (a) zonas add-on no seleccionadas en la cotización (mismo
  // criterio que el GET del checklist), y (b) con N>=2, el reparto real de
  // zonas por operario (zone-assignment.ts): un empleado nunca puede
  // completar zonas que el candado de reparto ni siquiera le mostró. Si el
  // reparto no aplica o falla, se degrada a exigir todas (comportamiento
  // previo, nunca más permisivo que antes).
  let myClosureZones: string[] | null = null;
  try {
    const plan = await ensureZoneAssignment(supabase, orderId);
    if (plan.size > 0) myClosureZones = plan.get(employeeId) ?? [];
  } catch (e) {
    console.error("Zone assignment error in closure protocol (degrading to all zones):", e);
  }

  const checklists = (checklistsRaw || []).filter(
    (cl: { zone: string; is_addon_zone?: boolean }) => {
      if (cl.is_addon_zone && !selectedAddonZones.has(cl.zone)) return false;
      if (myClosureZones !== null && !myClosureZones.includes(cl.zone)) return false;
      return true;
    }
  );

  const { data: responses } = await supabase
    .from("service_checklist_items")
    .select("checklist_id, is_completed, photo_url")
    .eq("order_id", orderId)
    .eq("employee_id", employeeId);

  const responsesByChecklist = new Map<string, { is_completed: boolean; photo_url: string | null }[]>();
  for (const r of responses || []) {
    const list = responsesByChecklist.get(r.checklist_id) || [];
    list.push(r);
    responsesByChecklist.set(r.checklist_id, list);
  }

  const zones: ZoneClosureStatus[] = (checklists || []).map(
    (cl: { id: string; zone: string; zone_label: string; items: { id: string; required?: boolean }[] }) => {
      const totalItems = (cl.items || []).length;
      const zoneResponses = responsesByChecklist.get(cl.id) || [];
      const completedItems = zoneResponses.filter((r) => r.is_completed).length;
      const hasAfterPhoto = zoneResponses.some((r) => !!r.photo_url);
      return {
        zone: cl.zone,
        zoneLabel: cl.zone_label,
        totalItems,
        completedItems,
        hasAfterPhoto,
      };
    }
  );

  const { data: closure } = await supabase
    .from("service_closures")
    .select("implementos_confirmed, external_confirmation_type")
    .eq("order_id", orderId)
    .eq("employee_id", employeeId)
    .is("deleted_at", null)
    .maybeSingle();

  return evaluateClosureProtocol({
    zones,
    implementsConfirmed: closure?.implementos_confirmed || false,
    externalConfirmation: (closure?.external_confirmation_type as ExternalConfirmationType) || null,
  });
}

/**
 * v8.3 E6 Sesión H — dispara las comunicaciones reales del cierre de
 * servicio: (1) confirmación de cierre con galería (evento
 * 'service_completed'), y (2) solicitud de reseña con link + QR (evento
 * 'review_request', invariante B.2.18) para TODOS los cierres completos,
 * salvo la única excepción documentada: discrepancia crítica aún abierta
 * (hasOpenCriticalDispute, src/lib/review-delivery.ts).
 */
async function sendClosureCommunications(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orderId: string,
  userId: string
): Promise<void> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, review_token")
    .eq("id", orderId)
    .single();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  const { data: clientProfile } = await supabase
    .from("client_profiles")
    .select("preferred_languages, no_smartphone_flow")
    .eq("user_id", userId)
    .maybeSingle();

  const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] ||
    "en") as "en" | "zh" | "fr";
  const clientName = profile?.full_name || "cliente";
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://app.luluisland.ca").replace(/\/$/, "");

  // v8.3 E6.6: cliente sin smartphone -- en vez del link de galería de fotos
  // (que no puede abrir cómodamente), se le avisa que recibirá una llamada
  // de seguimiento en ~2h. 'no_smartphone_callback' usa default_channel='call'
  // (migración 201): dispatchCommunication lo registra siempre como 'queued'
  // porque no hay proveedor de voz conectado todavía (mismo estado honesto
  // que telephony-router.ts) -- nunca se finge que la llamada ocurrió.
  if (clientProfile?.no_smartphone_flow) {
    await dispatchCommunication(supabase, {
      eventKey: "no_smartphone_callback",
      userId,
      orderId,
      language,
      vars: { client_name: clientName },
    });
  } else {
    await dispatchCommunication(supabase, {
      eventKey: "service_completed",
      userId,
      orderId,
      language,
      vars: {
        client_name: clientName,
        gallery_link: `${baseUrl}/orders/${orderId}/galeria`,
      },
    });
  }

  // Invariante B.2.18 (anti-gating Google/FTC): se solicita a TODOS los
  // servicios completos. Única exclusión: discrepancia crítica aún abierta.
  // Fix auditoría de seguridad externa (2026-08-02): si esta consulta
  // fallaba (error de red, timeout de DB), el `|| []` trataba el error
  // exactamente igual que "no hay disputas abiertas" -- fail-open sobre una
  // excepción documentada de anti-gating (B.2.18): con una disputa crítica
  // real pero invisible por el error, igual se solicitaría la reseña. Debe
  // fallar cerrado: si no se puede verificar el estado de disputas, no se
  // solicita la reseña (se puede reintentar en el próximo evento de
  // completado o revisar manualmente), en vez de arriesgarse a pedir una
  // reseña de 5 estrellas en medio de una disputa sin resolver.
  const { data: openTickets, error: openTicketsError } = await supabase
    .from("tickets_disputas")
    .select("type, priority, status")
    .eq("order_id", orderId)
    .in("status", ["open", "in_review"]);

  if (openTicketsError) {
    console.error(
      `[review_request] Omitido para orden ${orderId}: no se pudo verificar disputas abiertas (fail-closed): ${openTicketsError.message}`
    );
    return;
  }

  if (hasOpenCriticalDispute(openTickets || [])) {
    console.log(
      `[review_request] Omitido para orden ${orderId}: discrepancia crítica abierta ` +
        `(excepción documentada de B.2.18, tickets_disputas).`
    );
    return;
  }

  if (!order?.review_token) {
    console.error(`[review_request] Orden ${orderId} completada sin review_token — revisar trigger de migración 014.`);
    return;
  }

  const reviewLink = buildReviewLink(order.review_token, baseUrl);
  const qrSvg = await buildReviewQrSvg(order.review_token, baseUrl);

  const { error: qrUpdateError } = await supabase
    .from("orders")
    .update({ review_qr_svg: qrSvg })
    .eq("id", orderId);

  if (qrUpdateError) {
    console.error(
      `[review_request] Orden ${orderId}: no se pudo guardar review_qr_svg: ${qrUpdateError.message} — el link de reseña sigue funcionando, pero el QR no se persistió.`
    );
  }

  await dispatchCommunication(supabase, {
    eventKey: "review_request",
    userId,
    orderId,
    language,
    vars: {
      client_name: clientName,
      review_link: reviewLink,
    },
  });
}

// POST /api/employee/service — T_in, T_start, T_out, foto, nota
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orderId,
      eventType,
      locationLat,
      locationLng,
      photoUrl,
      notes,
      geofenceBypass,
      geofenceBypassCategory,
      geofenceBypassReason,
      // Auditoría UX/seguridad 2026-07-25 (#4): si el empleado genuinamente
      // no puede tomar una foto (celular sin cámara operativa, cliente
      // pide no fotografiar el interior, etc.), el bypass de geocerca
      // acepta una justificación escrita en su lugar -- nunca se pierde el
      // registro de que esto pasó "sin foto", queda marcado igual que
      // cualquier otro bypass (geofence_bypass=true) para revisión de
      // supervisor, con la justificación guardada en notes.
      geofenceBypassNoPhoto,
      geofenceBypassNoPhotoReason,
    } = body;

    if (!orderId || !eventType) {
      return NextResponse.json({ error: "Missing orderId or eventType" }, { status: 400 });
    }

    const validEvents = ["t_in", "t_start", "t_out", "photo", "note"];
    if (!validEvents.includes(eventType)) {
      return NextResponse.json({ error: `Invalid eventType. Must be one of: ${validEvents.join(", ")}` }, { status: 400 });
    }

    // v8.3 E4 fix (auditoría 2026-07-18) — bypass de geocerca de T_in sin
    // las 3 salvaguardas. La UI ya exige countdown de 120s + foto + razón
    // + categoría antes de habilitar el botón de bypass, pero eso solo
    // protege contra el uso normal de la app — nada impedía llamar a esta
    // API directo con geofenceBypass:true y sin foto/razón. Server-side es
    // donde realmente se hace cumplir: si se declara bypass, TODOS los
    // campos son obligatorios, o se rechaza.
    const validBypassCategories = ["gps_inaccurate", "building_entrance_far", "parking_restriction", "other"];
    const isNoPhotoBypass = eventType === "t_in" && geofenceBypass === true && geofenceBypassNoPhoto === true;
    // v8.3 fix (auditoría UX/UI/seguridad 2026-07-25, P0 #1): el mínimo de
    // caracteres para la justificación escrita (tanto la razón general como
    // la de "no puedo tomar foto") subió de 10 a 30 -- 10 caracteres permitía
    // justificaciones vacías de contenido real ("estoy aquí", "sin señal")
    // que no le dan a un supervisor nada verificable. Esto es un mínimo de
    // higiene del dato, NO un reemplazo de la aprobación real: ver más abajo,
    // geofence_bypass_review_status siempre queda 'pending_supervisor_review'.
    const MIN_BYPASS_REASON_LENGTH = 30;
    if (eventType === "t_in" && geofenceBypass === true) {
      const reason = typeof geofenceBypassReason === "string" ? geofenceBypassReason.trim() : "";
      if (!validBypassCategories.includes(geofenceBypassCategory) || reason.length < MIN_BYPASS_REASON_LENGTH) {
        return NextResponse.json(
          {
            error:
              `Geofence bypass requires a reason category and a written reason of at least ${MIN_BYPASS_REASON_LENGTH} characters — both are mandatory.`,
          },
          { status: 400 }
        );
      }
      if (isNoPhotoBypass) {
        // Sin foto: exige una justificación escrita explícita en su lugar
        // (nunca se acepta bypass sin foto Y sin explicar por qué).
        const noPhotoReason =
          typeof geofenceBypassNoPhotoReason === "string" ? geofenceBypassNoPhotoReason.trim() : "";
        if (noPhotoReason.length < MIN_BYPASS_REASON_LENGTH) {
          return NextResponse.json(
            {
              error:
                `If you can't take a photo, please explain why in at least ${MIN_BYPASS_REASON_LENGTH} characters -- this is required for supervisor review.`,
            },
            { status: 400 }
          );
        }
      } else if (typeof photoUrl !== "string" || photoUrl.length === 0) {
        return NextResponse.json(
          {
            error:
              "Geofence bypass requires an evidence photo, unless you explicitly indicate you can't take one and explain why.",
          },
          { status: 400 }
        );
      }
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar perfil de empleado
    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    // Verificar que el empleado tiene asignación para este order
    const { data: assignment, error: assignError } = await supabase
      .from("assignments")
      .select("id, status")
      .is("deleted_at", null)
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .single();

    if (assignError || !assignment) {
      return NextResponse.json({ error: "No assignment found for this service" }, { status: 403 });
    }

    // Fix Kimi-A4 (auditoría externa Kimi Code, 2026-07-21, verificado y
    // confirmado real, parte 1/2): esta ruta nunca verificaba que la
    // asignación siguiera activa antes de aceptar t_in/t_start/t_out --
    // un empleado podía marcar tiempos sobre una asignación ya cancelada
    // (ej. porque el cliente canceló la orden, ver orders/[orderId]/cancel
    // que sí marca assignments.status='cancelled', migración de esa
    // ruta más arriba en esta sesión).
    if (["t_in", "t_start", "t_out"].includes(eventType) && assignment.status === "cancelled") {
      return NextResponse.json(
        { error: "This assignment was cancelled -- time events are no longer accepted" },
        { status: 409 }
      );
    }

    // Actualizar status de la asignación según el evento (solo para eventos de progreso)
    let newStatus = assignment.status;
    if (eventType === "t_in") newStatus = "arrived";
    if (eventType === "t_start") newStatus = "in_progress";
    if (eventType === "t_out") newStatus = "completed";

    // Validar secuencia: no permitir t_start sin t_in, ni t_out sin t_start
    if (eventType === "t_start" && assignment.status !== "arrived") {
      return NextResponse.json({ error: "Must check in (T_in) before starting service" }, { status: 400 });
    }
    if (eventType === "t_out" && assignment.status !== "in_progress") {
      return NextResponse.json({ error: "Must start service (T_start) before finishing" }, { status: 400 });
    }

    // Fix Kimi-A4 (auditoría externa Kimi Code, 2026-07-21, verificado y
    // confirmado real, parte 2/2): T_in nunca validaba la geocerca contra
    // la dirección real del servicio -- ARRIVAL_GEOFENCE_RADIUS_METERS
    // (src/lib/geocode.ts) ya existía, creado exactamente para este caso,
    // pero nunca se conectó aquí. Sin esto, un empleado podía declarar
    // t_in desde cualquier parte (o sin GPS) mientras nunca marcara
    // geofenceBypass:true -- las 3 salvaguardas de bypass de arriba solo
    // se exigen SI el cliente decide declarar bypass, nunca se fuerza la
    // declaración cuando realmente hace falta.
    if (eventType === "t_in" && geofenceBypass !== true) {
      const { data: orderForGeofence } = await supabase
        .from("orders")
        .select("address_lat, address_lng")
        .eq("id", orderId)
        .maybeSingle();

      const hasOrderCoords =
        typeof orderForGeofence?.address_lat === "number" &&
        typeof orderForGeofence?.address_lng === "number";
      const hasReportedCoords = typeof locationLat === "number" && typeof locationLng === "number";

      if (hasOrderCoords && hasReportedCoords) {
        const distanceMeters = haversineDistance(
          { lat: locationLat, lng: locationLng },
          { lat: orderForGeofence!.address_lat as number, lng: orderForGeofence!.address_lng as number }
        );
        if (distanceMeters > ARRIVAL_GEOFENCE_RADIUS_METERS) {
          return NextResponse.json(
            {
              error:
                "GPS location is outside the arrival geofence for this service address. " +
                "If this is a real discrepancy (GPS inaccurate, entrance far from pin, parking restriction), " +
                "resubmit with geofenceBypass:true and the required reason/category/photo.",
              distanceMeters: Math.round(distanceMeters),
              allowedRadiusMeters: ARRIVAL_GEOFENCE_RADIUS_METERS,
              requiresBypass: true,
            },
            { status: 409 }
          );
        }
      } else if (!hasReportedCoords) {
        // Sin coordenadas reportadas del empleado, no hay forma de validar
        // -- se rechaza igual que estar fuera de la geocerca, no se acepta
        // un T_in "a ciegas" sin bypass declarado.
        return NextResponse.json(
          {
            error:
              "Location (locationLat/locationLng) is required for T_in unless geofenceBypass:true is declared.",
            requiresBypass: true,
          },
          { status: 400 }
        );
      }
      // Si el pedido no tiene address_lat/address_lng geocodificado
      // (hasOrderCoords===false), se degrada a permitir sin bloquear --
      // no hay contra qué comparar, y no se debe castigar al empleado por
      // un dato de geocodificación faltante del lado de la orden.
    }

    // E4.11 — Protocolo de Cierre Externo: T_out no se acepta sin checklist
    // 100%, foto "después" por zona, implementos confirmados y confirmación
    // externa. Rechazo con el detalle exacto de qué falta.
    if (eventType === "t_out") {
      const closureCheck = await checkClosureProtocol(supabase, orderId, employee.id);
      if (!closureCheck.complete) {
        return NextResponse.json(
          {
            error: "El Protocolo de Cierre Externo no está completo.",
            missing: closureCheck.missing,
          },
          { status: 400 }
        );
      }
    }

    if (newStatus !== assignment.status && ["t_in", "t_start", "t_out"].includes(eventType)) {
      await supabase
        .from("assignments")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", assignment.id);

      // Sync orders.status when service completes
      if (eventType === "t_out") {
        // v8.3 fix (auditoría 2026-07-15): antes esto se ejecutaba con
        // CUALQUIER empleado que hiciera T_out, así que en servicios con
        // equipo de 2+ personas (reparto de zonas, ver zone-assignment.ts)
        // la orden se marcaba "completed" y se disparaban las
        // comunicaciones de cierre (+ solicitud de reseña) apenas el
        // PRIMER empleado terminaba su parte, mientras el resto del
        // equipo seguía trabajando. Ahora se verifica que TODAS las
        // asignaciones activas (no canceladas, no soft-deleted) de esta
        // orden estén en status='completed' antes de cerrar la orden.
        // Fix (auditoría 2026-07-31, #5): .neq("status","cancelled") excluía
        // asignaciones canceladas del cómputo de allTeamDone, pero no las
        // 'no_show' (marcadas por el cron de no-show, ver
        // src/app/api/cron/no-show/route.ts) -- si un compañero de equipo
        // quedaba no_show, su asignación nunca pasa a 'completed' y el resto
        // del equipo jamás podía cerrar la orden. Se excluyen ambos estados
        // terminales-no-trabajados del set de asignaciones "activas".
        const { data: allAssignments } = await supabase
          .from("assignments")
          .select("id, status")
          .is("deleted_at", null)
          .not("status", "in", "(cancelled,no_show)")
          .eq("order_id", orderId);

        const allTeamDone =
          !!allAssignments &&
          allAssignments.length > 0 &&
          allAssignments.every((a: { status: string }) => a.status === "completed");

        if (allTeamDone) {
          const { data: order } = await supabase
            .from("orders")
            .select("user_id")
            .eq("id", orderId)
            .single();

          // v8.3 fix (auditoría 2026-07-21, A-14): compare-and-swap real.
          // Antes este UPDATE no llevaba .eq("status", ...) como guarda, así
          // que dos t_out casi simultáneos del último miembro del equipo (o
          // dos reintentos de red del mismo request) podían AMBOS leer
          // allTeamDone===true y ambos disparar sendClosureCommunications +
          // increment_client_services_count -- dos emails de galería y dos
          // solicitudes de reseña al mismo cliente. Ahora el UPDATE exige
          // status='confirmed' (único estado previo válido antes de
          // completar) y se revisa cuántas filas afectó: solo la petición
          // que realmente ganó la carrera (transicionó la fila) dispara los
          // efectos secundarios. La que pierde ve 0 filas afectadas y no
          // hace nada más -- sin error, sin duplicar.
          const { data: updatedOrders } = await supabase
            .from("orders")
            .update({ status: "completed", updated_at: new Date().toISOString() })
            .eq("id", orderId)
            .eq("status", "confirmed")
            .select("id");

          const wonRace = !!updatedOrders && updatedOrders.length > 0;

          if (wonRace) {
            // Incrementar contador de servicios completados del cliente
            if (order?.user_id) {
              await supabase.rpc("increment_client_services_count", {
                target_user_id: order.user_id,
              });
            }

            // E6 Sesión H — confirmación de cierre de servicio + entrega real de
            // reseña (B.2.18 anti-gating). El UPDATE de arriba ya disparó
            // generate_review_token_trigger (migración 014), así que releemos la
            // orden para obtener el review_token recién generado. Un fallo de
            // comunicaciones nunca debe revertir un T_out ya válido — por eso va
            // en su propio try/catch, después de que el cierre quedó confirmado.
            if (order?.user_id) {
              try {
                await sendClosureCommunications(supabase, orderId, order.user_id);
              } catch (commErr) {
                console.error("Error disparando comunicaciones de cierre (T_out):", commErr);
              }
            }
          } else {
            console.log(
              `[t_out] Orden ${orderId}: otra petición concurrente ya la marcó 'completed' primero -- se omiten comunicaciones/incremento duplicados (A-14).`
            );
          }
        }
      }
    }

    // Insertar log del evento con timestamp ISO explícito en Vancouver
    // toLocaleString sin timezone offset produce string ambiguo para Postgres TIMESTAMPTZ
    // v8.3 ROUND 4 fix (#2): antes parseaba "PDT"/"PST" de toLocaleString(), que puede
    // devolver "GMT-7" en vez de la abreviatura según navegador/runtime. Usamos el offset
    // numérico real vía Intl (getVancouverOffset), robusto en cualquier entorno.
    const now = new Date();
    const vancouverLocal = now.toLocaleString("en-CA", { timeZone: "America/Vancouver", hour12: false });
    const vancouverDateOnly = vancouverLocal.split(",")[0];
    const vancouverOffset = getVancouverOffset(vancouverDateOnly);
    const vancouverTimestamp = vancouverLocal.replace(", ", "T") + vancouverOffset;
    const isGeofenceBypass = eventType === "t_in" && geofenceBypass === true;
    // Si no hubo foto de evidencia (isNoPhotoBypass), la justificación va al
    // frente de `notes` con una etiqueta explícita -- así queda visible para
    // quien revise service_logs con geofence_bypass=true, igual que
    // cualquier otro bypass, sin requerir un campo/migración nueva.
    const notesWithBypassContext =
      isGeofenceBypass && isNoPhotoBypass
        ? `[NO PHOTO — supervisor review needed] ${String(geofenceBypassNoPhotoReason).trim()}${notes ? ` | ${notes}` : ""}`
        : notes ?? null;
    // v8.3 fix (auditoría UX/UI/seguridad 2026-07-25, P0 #1): un bypass de
    // geocerca NUNCA se inserta como aprobado -- las 3 salvaguardas de la UI
    // (countdown, foto/justificación, razón+categoría) generan evidencia
    // para revisión, no una aprobación. geofence_bypass_review_status queda
    // SIEMPRE 'pending_supervisor_review' en el momento del insert; solo un
    // supervisor/admin (endpoint todavía no implementado) puede pasarlo a
    // 'approved'/'rejected'.
    //
    // Fix (auditoría 2026-07-31, #3): antes esto solo quedaba como fila
    // consultable, sin ninguna notificación activa hacia un supervisor --
    // se reutiliza publishUnifiedAlert (misma bandeja consolidada que usa
    // safety-abort, ver /admin/alerts) para que el bypass aparezca de
    // inmediato con severidad p1_urgent (no es una emergencia de seguridad
    // humana como un SOS, pero sí requiere revisión pronta). No bloquea el
    // flujo del empleado si falla -- publishUnifiedAlert nunca lanza.
    const { data: log, error: logError } = await supabase
      .from("service_logs")
      .insert({
        order_id: orderId,
        employee_id: employee.id,
        event_type: eventType,
        timestamp: vancouverTimestamp,
        location_lat: locationLat ?? null,
        location_lng: locationLng ?? null,
        photo_url: photoUrl ?? null,
        notes: notesWithBypassContext,
        geofence_bypass: isGeofenceBypass,
        geofence_bypass_category: isGeofenceBypass ? geofenceBypassCategory : null,
        geofence_bypass_reason: isGeofenceBypass ? String(geofenceBypassReason).trim() : null,
        geofence_bypass_review_status: isGeofenceBypass ? "pending_supervisor_review" : null,
      })
      .select()
      .single();

    if (logError) {
      console.error("Service log error:", logError);
      console.error("logError:", logError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    if (isGeofenceBypass) {
      const alertResult = await publishUnifiedAlert(supabase, {
        sourceModule: "geofence_bypass",
        sourceTable: "service_logs",
        sourceId: log.id as string,
        tier: "respond_10min",
        severity: "p1_urgent",
        title: "Bypass de geocerca pendiente de revisión",
        summary: `Empleado ${employee.id} declaró bypass en orden ${orderId} (categoría: ${
          geofenceBypassCategory || "sin categoría"
        }).${isNoPhotoBypass ? " Sin foto de evidencia." : ""}`,
      });
      if (!alertResult.success) {
        console.error("Geofence bypass alert publish error:", alertResult.error);
      }
    }

    return NextResponse.json(
      {
        success: true,
        eventType,
        logId: log.id,
        assignmentStatus: newStatus,
        timestamp: log.timestamp,
        // v8.3 fix (auditoría 2026-07-25, P0 #1): así la UI puede mostrar que
        // este check-in quedó pendiente de revisión de supervisor, en vez de
        // dar a entender que ya fue aprobado.
        geofenceBypassPendingReview: isGeofenceBypass,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}
