import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  detectReciprocalHighRatings,
  hasSufficientVoterSample,
  type PeerVote,
} from "@/lib/peer-vote-integrity";
import { evaluateLowScoreStreak, type WeeklyScoreRecord } from "@/lib/low-score-streak";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { requireCronAuth } from "@/lib/cron-auth";
import { getSupabaseServiceKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

/** v8.3 E5: cuántas semanas anteriores hace falta mirar para detectar una racha de 3. */
const STREAK_LOOKBACK_WEEKS = 2;

/**
 * v8.3 E5: peer_score neutral cuando la muestra de votantes es insuficiente
 * (hasSufficientVoterSample) -- 1 solo voto (amigo u hostil) no debe decidir
 * el componente de pares del score.
 *
 * v8.3 auditoría 2026-07-21 (D-P0-7): employee_scores.peer_score vive en
 * escala 0-20 (`010_modulo7_qc_score_tables.sql:14`, comentario "-- 0-20"),
 * y `recalculate_weekly_score` (migración 192) ya lo devuelve como la
 * CONTRIBUCIÓN final al total (v_peer, sumado directo a v_total, no un
 * porcentaje a aplicar). El valor neutral interno que la propia función SQL
 * usa para muestra insuficiente es 10 (`v_peer := 10`), no 70. El código de
 * abajo trataba peer_score como si fuera 0-100 y lo multiplicaba de nuevo
 * por un peso de 20% -- doble escalado que dejaba total_score y el
 * peer_score guardado en la fila contradictorios entre sí.
 */
const NEUTRAL_PEER_SCORE = 10; // 0-20, mismo valor neutral que usa recalculate_weekly_score internamente

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
function getSupabaseClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceKey());
}

// GET /api/cron/weekly-scores — recalcular scores semanales de todos los empleados
// Protegido por CRON_SECRET
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  try {
    const supabase = getSupabaseClient();

    // v8.3 auditoría 2026-07-21 (D-P0-6): "el lunes de esta semana" se
    // calculaba tomando la fecha de HOY directamente -- si el cron corre
    // el lunes a la 01:00 (como está programado), eso da el lunes que
    // ACABA DE EMPEZAR, una ventana en la que todavía nadie trabajó ni
    // votó. recalculate_weekly_score() sobre esa ventana vacía devuelve
    // telemetría 0 y peer neutro -> total 40 -> trust_level='suspended'
    // para TODA la plantilla, cada lunes.
    //
    // Fix: se toma el día de AYER en Vancouver y se busca su lunes real
    // (mismo patrón que empleado/ritual/inicio/route.ts:27-33), lo que da
    // el lunes de la semana que ACABA DE TERMINAR sin importar en qué
    // día de la semana efectivamente corra el cron.
    const vancouverDateStr = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).split(",")[0];
    const vancouverToday = new Date(vancouverDateStr + "T12:00:00Z");
    const vancouverYesterday = new Date(vancouverToday.getTime() - 24 * 60 * 60 * 1000);
    const day = vancouverYesterday.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(vancouverYesterday);
    monday.setUTCDate(vancouverYesterday.getUTCDate() - diff);
    const weekStart = monday.toISOString().split("T")[0]; // formato YYYY-MM-DD, lunes de la semana recién terminada

    // Empleados activos
    const { data: employees, error: empError } = await supabase
      .from("employees")
      .select("id, trust_level, suspension_reason")
      .eq("is_active", true);

    if (empError) {
      console.error("empError:", empError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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

    // Fix Kimi-M3 (auditoría externa Kimi Code, 2026-07-21, verificado y
    // confirmado real): este INSERT no tenía protección contra duplicados
    // si el cron se reintenta o corre dos veces para la misma semana.
    // detectReciprocalHighRatings() no garantiza un orden canónico entre
    // employeeA/employeeB entre corridas (depende del orden de iteración
    // del array de votos), así que un UNIQUE simple sobre
    // (employee_a, employee_b, week_start) no bastaría -- se verifica
    // primero si ya existe una bandera para este par en cualquier orden
    // (migración 237 agrega además un índice único sobre
    // LEAST/GREATEST(employee_a, employee_b) + week_start como respaldo
    // ante una carrera real entre dos ejecuciones concurrentes).
    const collusionPairs = detectReciprocalHighRatings(weekVotes);
    for (const pair of collusionPairs) {
      const { data: existingFlag } = await supabase
        .from("peer_vote_collusion_flags")
        .select("id")
        .eq("week_start", weekStart)
        .is("deleted_at", null)
        .or(
          `and(employee_a.eq.${pair.employeeA},employee_b.eq.${pair.employeeB}),and(employee_a.eq.${pair.employeeB},employee_b.eq.${pair.employeeA})`
        )
        .maybeSingle();

      if (existingFlag) {
        continue;
      }

      const { error: collusionInsertError } = await supabase.from("peer_vote_collusion_flags").insert({
        week_start: weekStart,
        employee_a: pair.employeeA,
        employee_b: pair.employeeB,
        rating_a_to_b: pair.ratingAtoB,
        rating_b_to_a: pair.ratingBtoA,
      });

      // El índice único de la migración 237 puede rechazar esta inserción
      // si otra ejecución concurrente ganó la carrera entre el SELECT de
      // arriba y este INSERT -- es el comportamiento esperado (defensa en
      // profundidad), no un error real; se loguea y se continúa.
      if (collusionInsertError) {
        console.error(
          `Collusion flag insert skipped for pair ${pair.employeeA}/${pair.employeeB} week ${weekStart} (likely duplicate):`,
          collusionInsertError.message
        );
      }
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
      const computedTrustLevel = scoreData?.[0]?.trust_level || "standard";

      // Fix Kimi-A10 (auditoría externa Kimi Code, 2026-07-21, verificado y
      // confirmado real): recalculate_weekly_score() (migración 227)
      // calcula trust_level PURO por umbral de puntaje, sin mirar si el
      // empleado ya está suspendido manualmente por detección de
      // manipulación del muro QC (employees.suspension_reason, ver
      // admin/qc/[orderId]/review/route.ts) -- ese flujo exige
      // explícitamente "revisión humana requerida antes de cualquier
      // decisión de despido (B.2.23)". Sin este guard, si el puntaje del
      // empleado se recupera la semana siguiente, este cron le devolvía
      // trust_level a 'standard'/'elite' AUTOMÁTICAMENTE, levantando la
      // suspensión sin que ningún humano interviniera -- exactamente lo
      // que B.2.23 prohíbe. No existe hoy ninguna ruta que limpie
      // suspension_reason (verificado por grep) -- por eso la única señal
      // disponible es su presencia; se preserva el trust_level actual
      // mientras suspension_reason siga sin limpiar, sin importar el
      // puntaje recién calculado.
      const trustLevel =
        emp.trust_level === "suspended" && emp.suspension_reason
          ? "suspended"
          : computedTrustLevel;
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
        // peer_score ya es la contribución directa 0-20 (no un porcentaje
        // a aplicar) -- se resta el valor crudo y se suma el neutral, sin
        // multiplicar por ningún peso adicional.
        totalScore = totalScore - peerScore + NEUTRAL_PEER_SCORE;
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
        return safeErrorResponse(err);
  }
}
