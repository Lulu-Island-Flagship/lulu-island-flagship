import { cookies as _cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  evaluateSeniorEligibility,
  evaluateManualOnlyLevel,
  nextCareerLevel,
  tenureMonths,
  SENIOR_CHECK_LABEL,
  type CareerLevel,
} from "@/lib/career-path";
import type { EmployeeCertificationRecord } from "@/lib/certifications";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

// Fix (auditoría externa, hallazgo A12): esta ruta usa `cookies()`
// (request-time) -- sin esto Next intentaba pre-renderizarla en build,
// generando warnings y riesgo de caché incorrecta.
export const dynamic = "force-dynamic";
// GET /api/employee/score — score propio + historial + evaluaciones
export async function GET() {
  try {
    const supabase = createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee: me, error: meError, status: meStatus } = await requireActiveEmployee<{
      id: string;
      name: string | null;
      trust_level: string | null;
      career_level: string | null;
      career_level_since: string | null;
      hire_date: string | null;
    }>(supabase, user.id, "id, name, trust_level, career_level, career_level_since, hire_date");

    if (!me) {
      return NextResponse.json({ error: meError }, { status: meStatus });
    }

    // Scores históricos. v8.3 E8 FIX-1 (auditoría, bug crítico): esta ruta
    // exponía total_score/telemetry_score/audit_score/peer_score en crudo al
    // propio empleado, violando el spec ("sin score numérico visible al
    // empleado"). Seguimos leyendo la fila completa de employee_scores
    // porque sustainedScoreAverage (más abajo) SÍ necesita el número interno
    // para calcular elegibilidad de nivel de carrera -- pero la respuesta
    // JSON que sale de esta función nunca debe incluir esos 4 campos
    // numéricos. Ver sanitización antes del NextResponse.json() al final.
    const { data: scores, error: scoresError } = await supabase
      .from("employee_scores")
      .select("*")
      .eq("employee_id", me.id)
      .order("week_start", { ascending: false })
      .limit(10);

    if (scoresError) {
      console.error("Scores error:", scoresError);
    }

    // Evaluaciones de auditor
    const { data: audits, error: auditsError } = await supabase
      .from("field_audits")
      .select("*")
      .eq("employee_id", me.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (auditsError) {
      console.error("Audits error:", auditsError);
    }

    // Servicios recientes
    const { data: recentServices, error: servicesError } = await supabase
      .from("assignments")
      .select("order_id, status, created_at")
      .is("deleted_at", null)
      .eq("employee_id", me.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (servicesError) {
      console.error("Services error:", servicesError);
    }

    // v8.3 E8 (D.11): insignias ganadas + bono (si aplica)
    const { data: badges, error: badgesError } = await supabase
      .from("employee_badges")
      .select("id, badge_key, earned_at, evidence, employee_badge_bonuses(bonus_cents)")
      .eq("employee_id", me.id)
      .order("earned_at", { ascending: false });

    if (badgesError) {
      console.error("Badges error:", badgesError);
    }

    // v8.3 E8 (D.11) criterio de aceptación: "Un empleado ve su etapa de
    // carrera y el requisito siguiente en la PWA" -- calculamos elegibilidad
    // del SIGUIENTE nivel (nunca escribimos career_level, ver career-path.ts).
    const nextLevel: CareerLevel | null = nextCareerLevel(me.career_level as CareerLevel);
    let nextLevelInfo: {
      level: CareerLevel;
      eligible: boolean;
      checks: { label: string; passed: boolean }[];
      unverifiableBySystem: string[];
    } | null = null;

    if (nextLevel === "senior") {
      const { data: certRows, error: certError } = await supabase
        .from("employee_certifications")
        .select("level, expires_at, revoked_at")
        .eq("employee_id", me.id);
      if (certError) console.error("Certifications error:", certError);

      const certificationRecords: EmployeeCertificationRecord[] = (certRows || []).map((c) => ({
        level: c.level as 1 | 2 | 3,
        expiresAtISO: c.expires_at,
        revokedAtISO: c.revoked_at,
      }));

      const todayISO = new Date().toISOString();
      const recentTotals = (scores || []).slice(0, 4).map((s) => s.total_score);
      const sustainedScoreAverage =
        recentTotals.length > 0 ? recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length : 0;

      const result = evaluateSeniorEligibility({
        tenureMonths: me.hire_date ? tenureMonths(me.hire_date, todayISO) : 0,
        certificationRecords,
        todayISO,
        sustainedScoreAverage,
      });

      nextLevelInfo = {
        level: nextLevel,
        eligible: result.eligible,
        checks: Object.entries(result.checks).map(([key, passed]) => ({
          label: SENIOR_CHECK_LABEL[key] || key,
          passed,
        })),
        unverifiableBySystem: result.unverifiableBySystem,
      };
    } else if (nextLevel && nextLevel !== "trabajador") {
      const result = evaluateManualOnlyLevel(nextLevel);
      nextLevelInfo = {
        level: nextLevel,
        eligible: result.eligible,
        checks: [],
        unverifiableBySystem: result.unverifiableBySystem,
      };
    }

    // v8.3 E8 FIX-1: no numérico hacia el empleado. Reemplazamos el score
    // agregado semanal por un nivel cualitativo (mismo trust_level que ya
    // usa el resto del sistema: elite/standard/observation/suspended) y
    // quitamos total_score/telemetry_score/audit_score/peer_score del
    // historial -- solo queda lo operativo (semana, conteo de servicios,
    // disputas) que no funciona como "puntaje" competitivo.
    const sanitizedScores = (scores || []).map((s) => ({
      id: s.id,
      week_start: s.week_start,
      trust_level: s.trust_level,
      services_count: s.services_count,
      disputes_count: s.disputes_count,
    }));

    return NextResponse.json({
      employee: me,
      qualitativeLevel: me.trust_level, // elite | standard | observation | suspended
      scores: sanitizedScores,
      audits: audits || [],
      recentServices: recentServices || [],
      badges: badges || [],
      nextLevel: nextLevelInfo,
    }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}
