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

// Helper: obtener fecha actual en zona horaria America/Vancouver como string YYYY-MM-DD
function getVancouverDateString(): string {
  return new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).split(",")[0];
}

// POST /api/client/review — guardar evaluación post-servicio (Fase 8.1)
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { orderId, rating, comment } = body;

    if (!orderId || !rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Missing or invalid rating" }, { status: 400 });
    }

    // Verificar que la orden pertenece al usuario, está completada, y no expiró
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, user_id, service_date")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.user_id !== user.id) {
      return NextResponse.json({ error: "Not your order" }, { status: 403 });
    }

    if (order.status !== "completed") {
      return NextResponse.json({ error: "Order not completed yet" }, { status: 400 });
    }

    // Ventana de 24h para evaluar: service_date + 1 día >= hoy en Vancouver
    // service_date es DATE (sin hora), así que la ventana es service_date + 1 día hasta las 23:59:59
    const vancouverToday = getVancouverDateString();
    const serviceDate = order.service_date as string; // YYYY-MM-DD
    const deadlineDate = new Date(serviceDate + "T00:00:00");
    deadlineDate.setDate(deadlineDate.getDate() + 1);
    const deadlineStr = deadlineDate.toISOString().split("T")[0]; // YYYY-MM-DD del día siguiente

    if (vancouverToday > deadlineStr) {
      return NextResponse.json({ error: "Review window expired" }, { status: 410 });
    }

    const deadlineIso = deadlineDate.toISOString();

    // Verificar que no haya una review ya existente
    const { data: existingReview } = await supabase
      .from("client_reviews")
      .select("id")
      .eq("order_id", orderId)
      .eq("user_id", user.id)
      .single();

    if (existingReview) {
      return NextResponse.json({ error: "Review already submitted" }, { status: 409 });
    }

    // Calcular sentimiento
    const { data: sentimentData, error: sentimentError } = await supabase
      .rpc("calculate_sentiment", { p_comment: comment || "" });

    const sentimentScore = sentimentError ? 0 : (sentimentData || 0);

    // Insertar review con expired_at
    const { data: review, error: reviewError } = await supabase
      .from("client_reviews")
      .insert({
        order_id: orderId,
        user_id: user.id,
        rating,
        comment: comment || null,
        sentiment_score: sentimentScore,
        expired_at: deadlineIso,
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

    return NextResponse.json({ review }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
