import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  detectReciprocalHighRatings,
  hasSufficientVoterSample,
  type PeerVote,
} from "@/lib/peer-vote-integrity";
import { evaluateLowScoreStreak, type WeeklyScoreRecord } from "@/lib/low-score-streak";
import { publishUnifiedAlert } from "@/lib/unified-alerts";

/** v8.3 E5: cuántas semanas anteriores hace falta mirar para detectar una racha de 3. */
const STREAK_LOOKBACK_WEEKS = 2;

/**
 * v8.3 E5: peer_score neutral cuando la muestra de votantes es insuficiente
 * (hasSufficientVoterSample) -- 1 solo voto (amigo u hostil) no debe decidir
 * el 20% del score. 70 = piso del nivel "Estándar" (spec E5.1), ni castigo ni
 * premio.
 */
const NEUTRAL_PEER_SCORE = 70;
const PEER_SCORE_WEIGHT = 0.2;

/**
 * v8.3 ROUND 2 — hallazgo crítico de auditoría: este cron usaba
 * createServerClient + cookies() (sesión de navegador). Vercel Cron lo
 * invoca server-to-server sin cookies -- auth.uid() NULL. employee_scores
 * no tiene política de INSERT/UPDATE para nadie más que el dueño de la fila
 * (que no existe todavía en un upsert) o supervisor autenticado;
 * employees.trust_level solo se puede actualizar vía "Employees update own
 * profile" (auth.uid()=user_id, nunca cierto para un cron); y
 * peer_vote_collusion_flags exige is_supervisor(auth.uid()). Con NULL en
 * auth.uid(), las tres escrituras quedaban bloqueadas por RLS en cada
 * corrida semanal -- el recálculo de score, trust_level y las banderas
 * anti-colusión probablemente nunca se persistieron. Mismo fix que
 * dispatch-scheduler/safety-abort-escalation/wellbeing-chemical-reassign.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

// GET /api/cron/weekly-scores — recalcular scores semanales de todos los empleados
// Protegido por CRON_SECRET
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  try {
    const supabase = getSupabaseClient();

    // Lunes de esta semana en zona horaria del negocio (America/Vancouver)
    const vancouverDate = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const weekStart = vancouverDate.split(",")[0]; // formato YYYY-MM-DD

    // Empleados activos
    const { data: employees, error: empError } = await supabase
      .from("employees")
      .select("id")
      .eq("is_active", true);

    if (empError) {
      return NextResponse.json({ error: empError.message }, { status: 500 });
    }

    // v8.3 E5 anti-gaming: votos crudos de la semana para detectar colusión
    // recíproca y exigir muestra mínima de votantes antes de confiar en
    // peer_score (src/lib/peer-vote-integrity.ts).
    const { data: weekVotesRaw, error: votesError } = await supabase
      .from("peer_votes")
      .select("voter_employee_id, target_employee_id, rating")
      .eq("week_start", weekStart);

    if (votesError) {
      console.error("Peer votes fetch error:", votesError);
    }
    const weekVotes: PeerVote[] = (weekVotesRaw || []).map((v) => ({
      voterEmployeeId: v.voter_employee_id,
      targetEmployeeId: v.target_employee_id,
      rating: v.rating,
    }));

    const collusionPairs = detectReciprocalHighRatings(weekVotes);
    for (const pair of collusionPairs) {
      await supabase.from("peer_vote_collusion_flags").insert({
        week_start: weekStart,
        employee_a: pair.employeeA,
        employee_b: pair.employeeB,
        rating_a_to_b: pair.ratingAtoB,
        rating_b_to_a: pair.ratingBtoA,
      });
    }

    const results = [];

    for (const emp of employees || []) {
      // Llamar a la función RPC para recalcular
      const { data: scoreData, error: scoreError } = await supabase
        .rpc("recalculate_weekly_score", {
          p_employee_id: emp.id,
          p_week_start: weekStart,
        });

      if (scoreError) {
        console.error(`Score calc error for ${emp.id}:`, scoreError);
        continue;
      }

      let totalScore = scoreData?.[0]?.total_score || 0;
      const trustLevel = scoreData?.[0]?.trust_level || "standard";
      const telemetryScore = scoreData?.[0]?.telemetry_score || 0;
      const auditScore = scoreData?.[0]?.audit_score || 0;
      let peerScore = scoreData?.[0]?.peer_score || 0;
      const servicesCount = scoreData?.[0]?.services_count || 0;
      const disputesCount = scoreData?.[0]?.disputes_count || 0;

      // Muestra insuficiente (< 2 votantes distintos, spec E5.2): el
      // peer_score crudo no es confiable -- se neutraliza a 70 y se
      // recalcula total_score con el mismo peso de 20% que usó el RPC, en
      // vez de dejar que 1 solo voto decida el 20% del score compuesto.
      if (!hasSufficientVoterSample(weekVotes, emp.id)) {
        totalScore = totalScore - peerScore * PEER_SCORE_WEIGHT + NEUTRAL_PEER_SCORE * PEER_SCORE_WEIGHT;
        peerScore = NEUTRAL_PEER_SCORE;
      }

      // Upsert en employee_scores
      const { error: upsertError } = await supabase
        .from("employee_scores")
        .upsert({
          employee_id: emp.id,
          week_start: weekStart,
          total_score: totalScore,
          telemetry_score: telemetryScore,
          audit_score: auditScore,
          peer_score: peerScore,
          trust_level: trustLevel,
          services_count: servicesCount,
          disputes_count: disputesCount,
        }, { onConflict: "employee_id,week_start" });

      if (upsertError) {
        console.error(`Upsert error for ${emp.id}:`, upsertError);
      }

      // Actualizar trust_level en employees
      await supabase
        .from("employees")
        .update({ trust_level: trustLevel })
        .eq("id", emp.id);

      // v8.3 E5 (auditoría 2026-07-18, migración 193) — causal documentable
      // "<50 puntos x 3 semanas consecutivas". Solo documenta (tabla +
      // alerta), NUNCA suspende ni despide automáticamente (B.2.23).
      const { data: priorWeeksRaw } = await supabase
        .from("employee_scores")
        .select("week_start, total_score")
        .eq("employee_id", emp.id)
        .lt("week_start", weekStart)
        .order("week_start", { ascending: false })
        .limit(STREAK_LOOKBACK_WEEKS);

      const priorWeeks: WeeklyScoreRecord[] = (priorWeeksRaw || []).map((w) => ({
        weekStart: w.week_start,
        totalScore: w.total_score,
      }));

      const streak = evaluateLowScoreStreak(
        { weekStart, totalScore: Math.round(totalScore) },
        priorWeeks
      );

      if (streak.isStreak) {
        const { error: streakInsertError } = await supabase
          .from("employee_low_score_streaks")
          .upsert(
            {
              employee_id: emp.id,
              week_start: weekStart,
              consecutive_weeks_below_50: streak.consecutiveWeeksBelow50,
              scores: streak.streakWeeks,
            },
            { onConflict: "employee_id,week_start" }
          );

        if (streakInsertError) {
          console.error(`Low score streak insert error for ${emp.id}:`, streakInsertError);
        } else {
          await publishUnifiedAlert(supabase, {
            sourceModule: "low_score_streak",
            sourceTable: "employee_low_score_streaks",
            sourceId: emp.id,
            tier: "can_wait",
            severity: "p2_automatic",
            title: "Empleado con score < 50 por 3+ semanas consecutivas",
            summary: `El empleado ${emp.id} acumula ${streak.consecutiveWeeksBelow50} semanas consecutivas con score total < 50 (semana actual: ${weekStart}). Registro informativo, ninguna acción automática tomada.`,
          });
        }
      }

      results.push({ employee_id: emp.id, total_score: totalScore, trust_level: trustLevel });
    }

    return NextResponse.json({
      week_start: weekStart,
      processed: results.length,
      collusionFlagsCreated: collusionPairs.length,
      results,
    }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
