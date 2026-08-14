import { NextRequest, NextResponse } from "next/server";
import { createClient as _createClient } from "@supabase/supabase-js";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
// Fix M2: Use authenticated client instead of service-role in public endpoint
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * v8.3 AUDITORÍA RESERVA→DINERO→RESEÑA — hallazgo real (justo el último
 * paso del flujo: "hasta que ponen una reseña"). Este endpoint dice
 * explícitamente en su propio comentario "Autenticación por token
 * (review_token) — no requiere login de usuario" -- el cliente hace clic
 * en un link de SMS/email y normalmente NO tiene una sesión de navegador
 * activa. Pero usaba el cliente cookie-based (createServerClient), y
 * "Clients insert own reviews" (migración 010) exige
 * WITH CHECK (auth.uid() = user_id) -- con auth.uid() NULL (sin sesión),
 * ese insert SIEMPRE fallaba por RLS. El control de acceso real aquí no es
 * la sesión, es el token: single-use (review_token_used_at), ventana de
 * 24h, atado a una orden específica -- exactamente el mismo modelo de
 * confianza que ya usa buildPaymentUpdateLink/el link de actualización de
 * pago. Se usa service role, con el token como única puerta de entrada.
 */
// Fix 2026-08-05 (auditoría, item 2.4): solo cliente anónimo. Los writes
// se delegaron a la RPC SECURITY DEFINER submit_client_review (migración 357).
// v8.3 auditoría 2026-07-21 (E-B7): offset PDT/PST real para una fecha
// dada, en vez del "-07:00" hardcodeado que el código original etiquetaba
// como "PST" (PST es -08:00; -07:00 es PDT) -- ese hardcode por sí solo
// no era la causa completa de la ventana 24-48h, pero sí un error real de
// zona horaria que se corrige junto con el bug principal de abajo.
function vancouverOffsetForDate(dateStr: string): string {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const isPDT = probe
    .toLocaleString("en-CA", { timeZone: "America/Vancouver", timeZoneName: "short" })
    .includes("PDT");
  return isPDT ? "-07:00" : "-08:00";
}

// POST /api/client/review — guardar evaluación post-servicio (Fase 8.1)
// Autenticación por token (review_token) — no requiere login de usuario
//
// EXCEPCIÓN INTENCIONAL (auditoría seguridad 2026-07-26): este endpoint es
// deliberadamente público / sin sesión, a diferencia del resto de rutas de
// /api/client/**. NO agregar un chequeo de auth.getUser()/sesión aquí -- el
// cliente llega por un link de SMS/email sin sesión de navegador activa (ver
// comentario completo arriba, líneas 4-18), y el control de acceso real es el
// review_token: single-use (review_token_used_at), ventana de 24h, atado a
// una orden específica. "Corregir" esto para exigir sesión rompería el flujo
// completo de reseñas post-servicio.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, rating, comment, phoneLast4 } = body;

    if (!token || !rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    const supabase = await createRouteSupabaseClient();

    // Verificar orden por review_token (no por orderId directo)
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, user_id, service_date, service_time, review_token_used_at")
      .eq("review_token", token)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Invalid or expired review link" }, { status: 404 });
    }

    // Rate limit: max 5 review attempts per order per day.
    // Usa el order.id como key en vez de IP — detrás de Vercel/Cloudflare
    // getClientIp() devolvía una IP compartida, haciendo que usuarios
    // distintos compartieran el mismo bucket de rate limit.
    // Con order.id, cada link de reseña tiene su propio límite.
    const { data: rateData, error: rateError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_ip_address: `review_${order.id}`,
        p_max_requests: 5,
      }
    );

    // Fix M1: Fail closed on rate limit RPC errors
    if (rateError) {
      console.error("Rate limit error:", rateError);
      return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
    }
    if (rateData && !rateData.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 }
      );
    }

    if (order.review_token_used_at) {
      return NextResponse.json({ error: "Review link already used" }, { status: 410 });
    }

    if (order.status !== "completed") {
      return NextResponse.json({ error: "Order not completed yet" }, { status: 400 });
    }

    // Fix (auditoría UX/seguridad 2026-07-30, BUG 4): review_token solo era
    // el link de SMS/email -- si se filtraba (reenviado, cacheado, indexado),
    // cualquiera con el link podía escribir la reseña en nombre del cliente.
    // No existe en el repo ningún otro patrón reutilizable de "segundo
    // factor" para flujos públicos por token (pre-review-survey exige
    // sesión, que aquí es justo lo que NO se puede pedir -- ver comentario de
    // "EXCEPCIÓN INTENCIONAL" arriba). Se agrega la verificación más simple
    // y consistente con lo que ya se captura en el sistema: los últimos 4
    // dígitos del teléfono del cliente (client_profiles.phone_number, mismo
    // campo que ya usa AuthModal/verificación telefónica obligatoria). Si el
    // perfil no tiene teléfono registrado (órdenes legacy previas a que la
    // verificación telefónica fuera obligatoria para TODA reserva), se
    // degrada de forma controlada al comportamiento anterior (solo token) en
    // vez de bloquear reseñas legítimas que no tienen ese dato disponible.
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("phone_number")
      .eq("user_id", order.user_id)
      .maybeSingle();

    if (profile?.phone_number) {
      const expectedLast4 = String(profile.phone_number).replace(/\D/g, "").slice(-4);
      const providedLast4 = typeof phoneLast4 === "string" ? phoneLast4.replace(/\D/g, "").slice(-4) : "";
      if (!providedLast4 || providedLast4.length !== 4) {
        return NextResponse.json({ error: "Phone verification required" }, { status: 400 });
      }
      if (providedLast4 !== expectedLast4) {
        return NextResponse.json({ error: "Phone verification failed" }, { status: 403 });
      }
    }

    // v8.3 auditoría 2026-07-21 (E-B7): la ventana real de "24h" se
    // calculaba como "hasta el FINAL DEL DÍA de service_date"
    // (serviceDate + "T23:59:59"), comparando además solo la parte de
    // FECHA (vancouverToday > deadlineStr) sin hora. Un servicio a las
    // 9am de un día daba una ventana real de hasta ~39h, y en el peor
    // caso (servicio recién pasada medianoche) casi 48h -- nunca
    // estrictamente 24h. Ahora la ventana es service_date+service_time
    // (o medianoche si no hay hora registrada) + 24h exactas, comparado
    // contra el instante actual real (Date.now()), no contra strings de
    // fecha truncados.
    const serviceDate = order.service_date as string;
    const serviceTime = (order.service_time as string | null) || "00:00:00";
    const offset = vancouverOffsetForDate(serviceDate);
    const serviceDateTime = new Date(`${serviceDate}T${serviceTime}${offset}`);
    const deadlineDate = new Date(serviceDateTime.getTime() + 24 * 60 * 60 * 1000);

    if (Date.now() > deadlineDate.getTime()) {
      return NextResponse.json({ error: "Review window expired" }, { status: 410 });
    }

    const deadlineIso = deadlineDate.toISOString();

    // Verificar que no haya una review ya existente para esta orden
    const { data: existingReview } = await supabase
      .from("client_reviews")
      .select("id")
      .eq("order_id", order.id)
      .single();

    if (existingReview) {
      return NextResponse.json({ error: "Review already submitted" }, { status: 409 });
    }

    // Fix 2026-08-05 (auditoría, item 2.4): en vez de instanciar un cliente
    // service-role en el endpoint, se llama una RPC SECURITY DEFINER
    // (submit_client_review, migración 357) que encapsula las 3 escrituras
    // (client_reviews, sentiment_alerts, orders) con privilegio mínimo.
    // El cliente anon llama la RPC; la función corre con privilegios
    // elevados solo para los writes, sin exponer SUPABASE_SERVICE_ROLE_KEY.

    // Calcular sentimiento
    const { data: sentimentData, error: sentimentError } = await supabase
      .rpc("calculate_sentiment", { p_comment: comment || "" });

    const sentimentScore = sentimentError ? 0 : (sentimentData || 0);

    // RPC SECURITY DEFINER: inserta review, crea alerta si sentimiento < -0.5,
    // marca token como usado — todo en una sola llamada atómica
    const { data: review, error: reviewError } = await supabase
      .rpc("submit_client_review", {
        p_order_id: order.id,
        p_user_id: order.user_id,
        p_rating: rating,
        p_comment: comment || null,
        p_sentiment_score: sentimentScore,
        p_deadline_iso: deadlineIso,
      });

    if (reviewError) {
      console.error("reviewError:", reviewError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ review }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}
