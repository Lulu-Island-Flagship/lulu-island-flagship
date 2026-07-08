/**
 * v8.3 E3 — Formación de equipo con reglas duras (función pura, testeable):
 *   1. LÍDER OBLIGATORIO: sin supervisor no hay equipo (M0, Fase 0.5).
 *   2. MATCH DE IDIOMA: el líder debe hablar un idioma de la cuenta del
 *      cliente; sin match, NO se asigna — queda pendiente para el admin
 *      (invariante B.2.13). El match parcial (otro miembro habla el idioma
 *      pero el líder no) se reporta como sugerencia, no bloquea al admin.
 *
 * Pendiente conocido (documentado en REPORTE_E2_E5): el modelo aún no
 * registra NIVEL de fluidez (Fluido/Nativo) — hoy languages es un array
 * plano. El refinamiento de niveles llega con la UI de onboarding E3.
 */

export interface DispatchCandidate {
  id: string;
  role: "cleaner" | "supervisor" | "driver";
  languages: string[];
  homeZone: string | null;
  trustLevel: "elite" | "standard" | "observation" | string;
}

export interface TeamResult {
  /** null => NO asignar: queda en cola de asignación pendiente para el admin */
  team: DispatchCandidate[] | null;
  leaderId: string | null;
  pendingReason?: "no_leader_available" | "no_language_match";
  /** match parcial u otras notas para el admin */
  warnings: string[];
}

function trustRank(t: string): number {
  return t === "elite" ? 2 : t === "standard" ? 1 : 0;
}

function speaks(candidate: DispatchCandidate, required: string[]): boolean {
  return required.some((lang) => candidate.languages.includes(lang));
}

/**
 * Construye un equipo de `teamSize` para una cuenta con `clientLanguages`
 * (ordenados por prioridad), priorizando misma zona y trust level.
 */
export function buildTeam(
  candidates: DispatchCandidate[],
  clientLanguages: string[],
  teamSize: number,
  clientZone: string | null
): TeamResult {
  const required = clientLanguages.length > 0 ? clientLanguages : ["en"];
  const warnings: string[] = [];

  const sortByAffinity = (a: DispatchCandidate, b: DispatchCandidate) => {
    const zone = (b.homeZone === clientZone ? 1 : 0) - (a.homeZone === clientZone ? 1 : 0);
    return zone || trustRank(b.trustLevel) - trustRank(a.trustLevel);
  };

  // Regla 1: líder obligatorio
  const leaders = candidates.filter((c) => c.role === "supervisor").sort(sortByAffinity);
  if (leaders.length === 0) {
    return { team: null, leaderId: null, pendingReason: "no_leader_available", warnings };
  }

  // Regla 2: el líder debe hablar un idioma de la cuenta
  const leader = leaders.find((l) => speaks(l, required));
  if (!leader) {
    const anyMemberSpeaks = candidates.some((c) => speaks(c, required));
    if (anyMemberSpeaks) {
      warnings.push(
        `Match parcial: hay personal que habla [${required.join(", ")}] pero ningún líder disponible lo habla. El admin puede aprobar manualmente.`
      );
    }
    return { team: null, leaderId: null, pendingReason: "no_language_match", warnings };
  }

  // Completar el equipo priorizando quienes también hablan el idioma
  const rest = candidates
    .filter((c) => c.id !== leader.id)
    .sort((a, b) => {
      const lang = (speaks(b, required) ? 1 : 0) - (speaks(a, required) ? 1 : 0);
      return lang || sortByAffinity(a, b);
    });

  const team = [leader, ...rest.slice(0, Math.max(0, teamSize - 1))];
  if (team.length < teamSize) {
    warnings.push(`Equipo incompleto: ${team.length}/${teamSize} disponibles.`);
  }
  return { team, leaderId: leader.id, warnings };
}
