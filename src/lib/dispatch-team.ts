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

/**
 * v8.3 E3 (invariante B.2.1) — Tope duro de tamaño de equipo:
 *
 *   "N_max = 3 en B2C residencial. Si HHE requiere más tiempo, se extiende
 *   la ventana horaria, nunca se aumenta N. B2B: según contrato, sin tope."
 *   (Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md, sección B.2, regla #1)
 *
 * Estado real antes de esta función (verificado leyendo
 * dispatch-scheduler/route.ts y pricing.ts): calculateTeamRequirements()
 * (pricing.ts, getNRange) ya calcula maxTeams=3 para cuentas B2C y ya
 * extiende blockedTimeMinutes cuando N=3 no alcanza a bajar el bloque al
 * máximo del spec — pero eso es cálculo de PRECIO/HHE, no una verificación
 * explícita en el punto donde se arma el payload de despacho. No existía
 * ninguna función que, dado un tamaño de equipo YA PROPUESTO, lo rechace
 * explícitamente si excede el tope. Esta función es esa verificación de
 * última línea: debe ser imposible construir un payload de despacho que le
 * pase un equipo de 4+ a una orden B2C sin que esto lo rechace.
 *
 * Nota: para B2B esta función NO impone un tope propio — "según contrato,
 * sin tope" significa que la única fuente de verdad es el contrato del
 * cliente (`b2bContractMaxTeams`, opcional). Si el llamador no lo provee,
 * no hay tope y `proposedSize` siempre es válido para B2B.
 */
export type DispatchOrderType = "b2c_residential" | "b2b";

export const B2C_RESIDENTIAL_N_MAX = 3;

export interface MaxTeamSizeEvaluation {
  /** true => proposedSize respeta el invariante, úsalo tal cual */
  valid: boolean;
  /** tamaño a usar realmente: proposedSize si valid, o la corrección */
  correctedSize: number;
  /**
   * true => la corrección requiere extender la ventana horaria (T_bloqueo)
   * en vez de subir N, porque el HHE de la orden efectivamente necesita más
   * tiempo del que N_max=3 puede cubrir en el bloque estándar.
   */
  extendTimeWindow: boolean;
  reason?: string;
}

/**
 * Valida (y de ser necesario corrige) el tamaño de equipo propuesto para una
 * orden, según el invariante B.2.1.
 *
 * - B2C residencial: `proposedSize` nunca puede superar 3. Si lo hace, se
 *   rechaza explícitamente (`valid: false`) y se corrige a 3
 *   (`correctedSize: 3`). Si además `hheRequiresMoreTime` es true, la
 *   corrección indica extender la ventana horaria (`extendTimeWindow: true`)
 *   — el tamaño de equipo JAMÁS sube para compensar.
 * - B2B: sin tope fijo. Si se provee `b2bContractMaxTeams` (el tope real del
 *   contrato del cliente) y `proposedSize` lo excede, se rechaza y corrige a
 *   ese tope contractual. Sin contrato provisto, cualquier tamaño es válido.
 */
export function enforceMaxTeamSize(
  orderType: DispatchOrderType,
  proposedSize: number,
  hheRequiresMoreTime: boolean,
  b2bContractMaxTeams?: number
): MaxTeamSizeEvaluation {
  if (orderType === "b2c_residential") {
    if (proposedSize <= B2C_RESIDENTIAL_N_MAX) {
      return { valid: true, correctedSize: proposedSize, extendTimeWindow: false };
    }
    return {
      valid: false,
      correctedSize: B2C_RESIDENTIAL_N_MAX,
      extendTimeWindow: hheRequiresMoreTime,
      reason:
        `Invariante B.2.1: N_max=3 en B2C residencial. Tamaño propuesto ` +
        `${proposedSize} RECHAZADO; corregido a ${B2C_RESIDENTIAL_N_MAX}.` +
        (hheRequiresMoreTime
          ? " El HHE requiere más tiempo del que N_max cubre en el bloque estándar: se debe extender la ventana horaria, nunca subir N."
          : ""),
    };
  }

  // B2B: "según contrato, sin tope" — solo se rechaza si el llamador provee
  // el tope real del contrato y se excede.
  if (typeof b2bContractMaxTeams === "number" && proposedSize > b2bContractMaxTeams) {
    return {
      valid: false,
      correctedSize: b2bContractMaxTeams,
      extendTimeWindow: false,
      reason: `B2B: el contrato limita a ${b2bContractMaxTeams} equipos; tamaño propuesto ${proposedSize} rechazado.`,
    };
  }
  return { valid: true, correctedSize: proposedSize, extendTimeWindow: false };
}
