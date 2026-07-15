/**
 * v8.3 E0.6 — Bandeja unificada de alertas: una sola cola, dos niveles
 * ("responder en 10 min" → dispara Fallback; "puede esperar").
 *
 * `publishUnifiedAlert` es la única función que cualquier módulo debe llamar
 * para que su alerta aparezca en la bandeja consolidada
 * (`/admin/alerts`, tabla `unified_alerts`, migración 147). No sustituye la
 * tabla de dominio del módulo (tickets_disputas, safety_aborts, etc.) —
 * publica una entrada paralela ligera además de lo que el módulo ya
 * escribía.
 *
 * Nunca lanza: si la escritura falla, devuelve el error en el resultado en
 * vez de tumbar el flujo que la llamó (la alerta es secundaria a la acción
 * principal del módulo, nunca debe bloquearla).
 */

export type UnifiedAlertTier = "respond_10min" | "can_wait";
export type UnifiedAlertSeverity = "p0_safety" | "p1_urgent" | "p2_automatic";

export interface PublishUnifiedAlertInput {
  sourceModule: string;
  sourceTable?: string;
  sourceId?: string;
  tier: UnifiedAlertTier;
  severity: UnifiedAlertSeverity;
  title: string;
  summary?: string;
}

export interface UnifiedAlertsClient {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: () => {
        single: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
}

export interface PublishUnifiedAlertResult {
  success: boolean;
  error: string | null;
}

export async function publishUnifiedAlert(
  supabase: UnifiedAlertsClient,
  input: PublishUnifiedAlertInput
): Promise<PublishUnifiedAlertResult> {
  const { error } = await supabase
    .from("unified_alerts")
    .insert({
      source_module: input.sourceModule,
      source_table: input.sourceTable ?? null,
      source_id: input.sourceId ?? null,
      tier: input.tier,
      severity: input.severity,
      title: input.title,
      summary: input.summary ?? null,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, error: null };
}

/** D.10: "Priorización: P0 seguridad humana → P1 <10 min → P2 automático." */
export function severityRank(severity: UnifiedAlertSeverity): number {
  const order: Record<UnifiedAlertSeverity, number> = { p0_safety: 0, p1_urgent: 1, p2_automatic: 2 };
  return order[severity];
}

export function sortAlertsBySeverity<T extends { severity: UnifiedAlertSeverity; created_at: string }>(
  alerts: T[]
): T[] {
  return [...alerts].sort((a, b) => {
    const rankDiff = severityRank(a.severity) - severityRank(b.severity);
    if (rankDiff !== 0) return rankDiff;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}
