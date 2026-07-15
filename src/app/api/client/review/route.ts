import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.ip || "unknown";
}

// Helper: obtener fecha actual en zona horaria America/Vancouver como string YYYY-MM-DD
function getVancouverDateString(): string {
  return new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).split(",")[0];
}

// POST /api/client/review — guardar evaluación post-servicio (Fase 8.1)
// Autenticación por token (review_token) — no requiere login de usuario
export async function POST(request: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { token, rating, comment } = body;

    if (!token || !rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // Rate limit: max 5 reviews per IP per day
    const ip = getClientIp(request);
    const { data: rateData, error: rateError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_ip_address: `review_${ip}`,
        p_max_requests: 5,
      }
    );

    if (rateError) {
      console.error("Rate limit error:", rateError);
    } else if (rateData && !rateData.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 }
      );
    }

    // Verificar orden por review_token (no por orderId directo)
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, user_id, service_date, review_token_used_at")
      .eq("review_token", token)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Invalid or expired review link" }, { status: 404 });
    }

    if (order.review_token_used_at) {
      return NextResponse.json({ error: "Review link already used" }, { status: 410 });
    }

    if (order.status !== "completed") {
      return NextResponse.json({ error: "Order not completed yet" }, { status: 400 });
    }

    // Ventana de 24h para evaluar: service_date + 1 día >= hoy en Vancouver
    const vancouverToday = getVancouverDateString();
    const serviceDate = order.service_date as string;
    // Crear fecha en timezone Vancouver explícito para evitar desfases del servidor
    const deadlineDate = new Date(serviceDate + "T23:59:59-07:00"); // PST (Vancouver)
    const deadlineStr = deadlineDate.toISOString().split("T")[0];

    if (vancouverToday > deadlineStr) {
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

    // Calcular sentimiento
    const { data: sentimentData, error: sentimentError } = await supabase
      .rpc("calculate_sentiment", { p_comment: comment || "" });

    const sentimentScore = sentimentError ? 0 : (sentimentData || 0);

    // Insertar review con review_window_expires_at (antes: expired_at)
    const { data: review, error: reviewError } = await supabase
      .from("client_reviews")
      .insert({
        order_id: order.id,
        user_id: order.user_id,
        rating,
        comment: comment || null,
        sentiment_score: sentimentScore,
        review_window_expires_at: deadlineIso,
      })
      .select()
      .single();

    if (reviewError) {
      return NextResponse.json({ error: reviewError.message }, { status: 500 });
    }

    // Si sentimiento < -0.5, crear alerta
    if (sentimentScore < -0.5) {
      await supabase
        .from("sentiment_alerts")
        .insert({
          client_review_id: review.id,
          sentiment_score: sentimentScore,
          status: "pending",
        });
    }

    // Marcar token como usado (pero mantenerlo para referencia)
    await supabase
      .from("orders")
      .update({ review_token_used_at: new Date().toISOString() })
      .eq("id", order.id);

    return NextResponse.json({ review }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
