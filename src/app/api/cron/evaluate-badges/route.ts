import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  BADGE_CATALOG,
  isEligibleForServiceGold,
  countExcellentAudits,
  isEligibleForDetailMaster,
  isEligibleForPromotionReady,
} from "@/lib/badges";
import { requireCronAuth } from "@/lib/cron-auth";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/cron/evaluate-badges — v8.3 E8 (D.11).
 *
 * Evalúa SOLO las 3 insignias honestamente computables (ver
 * src/lib/badges.ts para por qué las otras 4 no se automatizan) y, si un
 * empleado activo cruza el umbral, inserta en employee_badges +
 * employee_badge_bonuses. Idempotente: el UNIQUE(employee_id, badge_key,
 * period_key) de la migración 136 hace que reintentar el mismo período
 * nunca duplique una insignia ni su bono.
 *
 * Usa SUPABASE_SERVICE_ROLE_KEY (mismo motivo que wellbeing-chemical-reassign:
 * corre server-to-server sin sesión de usuario, RLS bloquearía is_supervisor(NULL)).
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
    const vancouverDate = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const todayIso = vancouverDate.split(",")[0];
    const vancouverToday = new Date(`${todayIso}T12:00:00-07:00`);
    const monday = new Date(vancouverToday);
    monday.setDate(vancouverToday.getDate() - vancouverToday.getDay() + 1);
    const weekStartIso = monday.toISOString().split("T")[0];

    const { data: employees, error: empError } = await supabase
      .from("employees")
      .select("id")
      .eq("is_active", true)
      .is("deleted_at", null);

    if (empError) {
      console.error("empError:", empError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const awarded: { employeeId: string; badgeKey: string }[] = [];

    for (const emp of employees || []) {
      // ---- service_gold: servicios completados sin disputa (histórico completo) ----
      const { data: assignedOrders } = await supabase
        .from("assignments")
        .select("order_id, orders!inner(status)")
        .eq("employee_id", emp.id)
        .is("deleted_at", null)
        .eq("orders.status", "completed");

      const completedOrderIds = (assignedOrders || []).map((a: { order_id: string }) => a.order_id);

      let disputedCount = 0;
      if (completedOrderIds.length > 0) {
        const { count } = await supabase
          .from("warranty_claims")
          .select("order_id", { count: "exact", head: true })
          .in("order_id", completedOrderIds);
        disputedCount = count || 0;
      }

      const withoutDispute = completedOrderIds.length - disputedCount;

      if (isEligibleForServiceGold({ completedServicesWithoutDisputeCount: withoutDispute })) {
        const inserted = await awardBadgeIfNew(supabase, {
          employeeId: emp.id,
          badgeKey: "service_gold",
          evidence: `${withoutDispute} servicios completados sin disputa`,
          creditDate: todayIso,
        });
        if (inserted) awarded.push({ employeeId: emp.id, badgeKey: "service_gold" });
      }

      // ---- detail_master: 10 auditorías de campo >= 92% (histórico completo) ----
      const { data: audits } = await supabase
        .from("field_audits")
        .select("criteria")
        .eq("employee_id", emp.id);

      const auditRatios = (audits || []).map((a: { criteria: Record<string, unknown> }) => {
        const values = Object.values(a.criteria || {}).filter((v): v is number => typeof v === "number");
        return { criteriaSum: values.reduce((s, v) => s + v, 0), criteriaMax: values.length * 5 };
      });

      if (isEligibleForDetailMaster(auditRatios)) {
        const excellentCount = countExcellentAudits(auditRatios);
        const inserted = await awardBadgeIfNew(supabase, {
          employeeId: emp.id,
          badgeKey: "detail_master",
          evidence: `${excellentCount} auditorías de campo con calificación >= 92%`,
          creditDate: todayIso,
        });
        if (inserted) awarded.push({ employeeId: emp.id, badgeKey: "detail_master" });
      }

      // ---- promotion_ready: últimas 4 semanas consecutivas con score > 90 ----
      const { data: recentScores } = await supabase
        .from("employee_scores")
        .select("total_score")
        .eq("employee_id", emp.id)
        .order("week_start", { ascending: false })
        .limit(4);

      const scores = (recentScores || []).map((s: { total_score: number }) => s.total_score);

      if (isEligibleForPromotionReady(scores)) {
        const inserted = await awardBadgeIfNew(supabase, {
          employeeId: emp.id,
          badgeKey: "promotion_ready",
          evidence: `Score > 90 en las últimas 4 semanas (${scores.slice(0, 4).join(", ")})`,
          creditDate: todayIso,
          periodKey: weekStartIso,
        });
        if (inserted) awarded.push({ employeeId: emp.id, badgeKey: "promotion_ready" });
      }
    }

    return NextResponse.json(
      { evaluated: (employees || []).length, awarded, weekStart: weekStartIso },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = SupabaseClient<any, "public", any>;

async function awardBadgeIfNew(
  supabase: SupabaseAdmin,
  params: { employeeId: string; badgeKey: string; evidence: string; creditDate: string; periodKey?: string }
): Promise<boolean> {
  const insertPayload: Record<string, unknown> = {
    employee_id: params.employeeId,
    badge_key: params.badgeKey,
    evidence: params.evidence,
  };
  if (params.periodKey) insertPayload.period_key = params.periodKey;

  const { data: badge, error } = await supabase
    .from("employee_badges")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    // Unique violation (23505) = ya se otorgó en este período -- esperado, no es un error real.
    if (error.code !== "23505") {
      console.error(`evaluate-badges insert error (${params.badgeKey}/${params.employeeId}):`, error);
    }
    return false;
  }

  const bonusCents = BADGE_CATALOG[params.badgeKey as keyof typeof BADGE_CATALOG]?.bonusCents ?? 0;
  if (bonusCents > 0) {
    const { error: bonusError } = await supabase.from("employee_badge_bonuses").insert({
      employee_id: params.employeeId,
      employee_badge_id: badge.id,
      bonus_cents: bonusCents,
      credit_date: params.creditDate,
    });
    if (bonusError) {
      console.error(`evaluate-badges bonus insert error (${params.badgeKey}/${params.employeeId}):`, bonusError);
    }
  }

  return true;
}
