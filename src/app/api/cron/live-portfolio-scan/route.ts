import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { decideCandidateEligibility, buildAnonymousLabel } from "@/lib/live-portfolio";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/live-portfolio-scan — v8.3 E5.15 "Live Portfolio"
 *
 * "Selección automática": identifica, entre los servicios completados que
 * todavía no tienen una fila en live_portfolio_candidates, los que cumplen
 * TODOS los criterios objetivos y verificables (checklist 100%, sin
 * warranty_claims abiertos, score del empleado ≥80, consentimiento de
 * fotos de marketing vigente). El juicio de "diferencia visual" queda para
 * la aprobación humana (ver nota honesta en src/lib/live-portfolio.ts) --
 * este cron NUNCA aprueba, solo surface candidatos.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: existingCandidates } = await supabase
      .from("live_portfolio_candidates")
      .select("order_id");
    const alreadyScanned = new Set((existingCandidates || []).map((c) => c.order_id));

    // Ventana razonable: últimos 14 días de servicios completados (evita
    // reescanear años de historial en cada corrida).
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 14);

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, user_id, service_date, quote_id")
      .eq("status", "completed")
      .gte("service_date", since.toISOString().slice(0, 10));

    if (ordersError) {

      console.error("ordersError:", ordersError);

      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });

    }
    let candidatesCreated = 0;
    const results: { orderId: string; eligible: boolean; reasons?: string[] }[] = [];

    for (const order of orders || []) {
      if (alreadyScanned.has(order.id)) continue;

      const { data: quote } = await supabase
        .from("quotes")
        .select("zone, service_subtype")
        .eq("id", order.quote_id)
        .maybeSingle();
      if (!quote) continue;

      const { data: clientProfile } = await supabase
        .from("client_profiles")
        .select("consent_photo_marketing")
        .eq("user_id", order.user_id)
        .maybeSingle();

      const { data: checklistItems } = await supabase
        .from("service_checklist_items")
        .select("is_completed, photo_url")
        .eq("order_id", order.id);
      const totalItems = (checklistItems || []).length;
      const completedItems = (checklistItems || []).filter((c) => c.is_completed).length;
      const checklistCompletionPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
      const candidatePhotoUrls = (checklistItems || [])
        .filter((c) => c.photo_url)
        .map((c) => c.photo_url as string);

      const { data: openClaims } = await supabase
        .from("warranty_claims")
        .select("id")
        .eq("order_id", order.id)
        .eq("status", "open");
      const hasActiveFlags = (openClaims || []).length > 0;

      const { data: tInLog } = await supabase
        .from("service_logs")
        .select("employee_id")
        .eq("order_id", order.id)
        .eq("event_type", "t_in")
        .limit(1)
        .maybeSingle();

      let employeeScore = 0;
      let employeeId: string | null = null;
      if (tInLog?.employee_id) {
        employeeId = tInLog.employee_id;
        const { data: scoreRow } = await supabase
          .from("employee_scores")
          .select("total_score")
          .eq("employee_id", tInLog.employee_id)
          .order("week_start", { ascending: false })
          .limit(1)
          .maybeSingle();
        employeeScore = scoreRow?.total_score ?? 0;
      }

      const decision = decideCandidateEligibility({
        checklistCompletionPercent,
        hasActiveFlags,
        employeeScore,
        hasPhotoMarketingConsent: Boolean(clientProfile?.consent_photo_marketing),
      });

      if (!decision.eligible) {
        results.push({ orderId: order.id, eligible: false, reasons: decision.reasons });
        continue;
      }

      if (candidatePhotoUrls.length === 0) {
        results.push({ orderId: order.id, eligible: false, reasons: ["no_photos"] });
        continue;
      }

      await supabase.from("live_portfolio_candidates").insert({
        order_id: order.id,
        client_user_id: order.user_id,
        employee_id: employeeId,
        checklist_completion_percent: checklistCompletionPercent,
        employee_score_at_selection: employeeScore,
        zone: quote.zone,
        service_subtype: quote.service_subtype,
        anonymous_label: buildAnonymousLabel(quote.zone, quote.service_subtype),
        candidate_photo_urls: candidatePhotoUrls,
      });

      candidatesCreated++;
      results.push({ orderId: order.id, eligible: true });
    }

    return NextResponse.json(
      { evaluated: (orders || []).length, candidatesCreated, results },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}
