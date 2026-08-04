import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchCommunication } from "@/lib/send-communication";
import { safeErrorResponse } from "@/lib/api-errors";
import { requireCronAuth } from "@/lib/cron-auth"; // Fix R5: constant-time cron auth

/**
 * GET /api/cron/appointment-confirmation-24h
 *
 * v8.3 E6.6 — Confirmación automática 24h antes del servicio. Del plan:
 * "Confirmación por llamada automática 24h antes ('[1=Sí] [2=Reagendar]
 * [3=Cancelar]', reintento 4h, fallback SMS, luego manual)".
 *
 * HONESTO: no hay proveedor de voz conectado (mismo estado que
 * src/lib/telephony-router.ts) -- 'appointment_confirmation_24h' tiene
 * default_channel='call' en el catálogo (migración 201), así que
 * dispatchCommunication SIEMPRE lo deja en 'queued' con la razón "Canal
 * 'call' sin adaptador real todavía". Este cron construye correctamente el
 * QUÉ y CUÁNDO (la mitad de negocio real: identificar qué orden confirmar y
 * en qué idioma) -- el CÓMO (llamada real con IVR, reintento 4h, fallback
 * SMS automático) queda pendiente de un proveedor de telefonía real. No se
 * simula ninguna de esas partes.
 *
 * Ventana: corre cada hora (ver vercel.json — relajado de cada 15 min a
 * hourly en la auditoría m-2 2026-07-20b: el canal 'call' no tiene
 * adaptador real todavía, así que "confirmar" hoy es solo encolar/loguear
 * -- no hay beneficio de UX en revisar cada 15 min algo que de todas formas
 * no llama a nadie en la práctica; y la ventana de 1h de coincidencia ya
 * tolera perfectamente una cadencia horaria) y confirma órdenes cuyo
 * service_datetime cae entre 23h45m y 24h45m desde ahora -- una ventana de
 * 1h para no depender de que el cron corra exactamente al minuto, con
 * orders.confirmation_24h_sent_at como guardia anti-duplicado.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(request: NextRequest) {
  // Fix R5: Use constant-time requireCronAuth instead of inline comparison
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000 + 45 * 60 * 1000); // +23h45m
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 45 * 60 * 1000); // +24h45m

  try {
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, user_id, service_date, service_time, service_datetime")
      .eq("status", "confirmed")
      .is("confirmation_24h_sent_at", null)
      .gte("service_datetime", windowStart.toISOString())
      .lt("service_datetime", windowEnd.toISOString());

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    let sent = 0;
    const results: { orderId: string; status: string }[] = [];

    for (const order of orders || []) {
      const { data: clientProfile } = await supabase
        .from("client_profiles")
        .select("preferred_languages")
        .eq("user_id", order.user_id)
        .maybeSingle();
      const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] || "en") as
        | "en"
        | "zh"
        | "fr";

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", order.user_id)
        .maybeSingle();

      const result = await dispatchCommunication(supabase, {
        eventKey: "appointment_confirmation_24h",
        userId: order.user_id,
        orderId: order.id,
        language,
        vars: {
          client_name: profile?.full_name || "there",
          service_date: order.service_date,
          service_time: order.service_time,
        },
      });

      await supabase
        .from("orders")
        .update({ confirmation_24h_sent_at: new Date().toISOString() })
        .eq("id", order.id);

      if (result.status === "sent" || result.status === "queued") sent++;
      results.push({ orderId: order.id, status: result.status });
    }

    return NextResponse.json({ evaluated: (orders || []).length, sent, results }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}
