/**
 * v8.3 D.11 — Catálogo de insignias con bono real.
 *
 * Honestidad de datos, no cobertura total: de las 7 insignias del spec,
 * solo 3 son evaluables hoy con datos que YA EXISTEN y sin inventar una
 * señal que no está ahí. Las otras 4 quedan marcadas `computable: false`
 * con la razón exacta -- otorgarlas con una aproximación falsa sería peor
 * que no otorgarlas, porque el bono es dinero real (B.1).
 *
 *   service_gold   (Oro de Servicio)   -- computable: assignments+orders+warranty_claims ya alcanzan.
 *   detail_master  (Maestro de Detalle) -- computable: field_audits.criteria ya alcanza.
 *   promotion_ready (Ascenso)          -- computable: employee_scores ya alcanza.
 *   eco_warrior    -- NO: depende de "Modo Eco", diferido por el propio spec (B.4, E11 sostenibilidad).
 *   flash          -- NO: no existe tracking de tiempo real-vs-estimado por servicio individual.
 *   team_player    -- NO: no existe tabla de cobertura de turnos ajenos.
 *   guardian       -- NO: near_misses.reported_by es el REPORTERO, no el sujeto del incidente.
 *                     Usarlo penalizaría a quien reporta -- contradice el diseño anti-represalia
 *                     del propio módulo de near-misses (nunca sancionar por reportar).
 */

export type BadgeKey =
  | "service_gold"
  | "eco_warrior"
  | "detail_master"
  | "flash"
  | "team_player"
  | "guardian"
  | "promotion_ready";

export interface BadgeDefinition {
  key: BadgeKey;
  name: string;
  bonusCents: number;
  description: string;
  computable: boolean;
  /** Por qué no es computable todavía, si aplica. */
  blockedReason?: string;
  /** true si se re-evalúa cada semana (period_key = lunes); false si es de una sola vez en la vida. */
  recurring: boolean;
}

export const BADGE_CATALOG: Record<BadgeKey, BadgeDefinition> = {
  service_gold: {
    key: "service_gold",
    name: "Oro de Servicio",
    bonusCents: 5000,
    description: "50 servicios sin disputa. +prioridad de ruta.",
    computable: true,
    recurring: false,
  },
  eco_warrior: {
    key: "eco_warrior",
    name: "Eco-Warrior",
    bonusCents: 3000,
    description: "20 servicios en Modo Eco.",
    computable: false,
    blockedReason: "\"Modo Eco\" no existe como feature -- el módulo de sostenibilidad está DIFERIDO por el propio spec (B.4, E11).",
    recurring: false,
  },
  detail_master: {
    key: "detail_master",
    name: "Maestro de Detalle",
    bonusCents: 4000,
    description: "10 auditorías de campo con calificación ≥92% (equivalente a ≥23/25). +acceso VIP.",
    computable: true,
    recurring: false,
  },
  flash: {
    key: "flash",
    name: "Flash",
    bonusCents: 2500,
    description: "5 servicios completados en menos del 85% del tiempo estimado, sin quejas.",
    computable: false,
    blockedReason: "No existe tracking de duración real (T_in/T_out) vs. HHE estimado por servicio individual todavía.",
    recurring: false,
  },
  team_player: {
    key: "team_player",
    name: "Team Player",
    bonusCents: 3500,
    description: "Cubrir 3 turnos de otro empleado.",
    computable: false,
    blockedReason: "No existe una tabla que registre cobertura de turnos ajenos (reasignaciones por ausencia).",
    recurring: false,
  },
  guardian: {
    key: "guardian",
    name: "Guardián",
    bonusCents: 6000,
    description: "6 meses sin incidente. +certificación pagada.",
    computable: false,
    blockedReason: "near_misses.reported_by identifica a quien REPORTA, no a quien está involucrado -- usarlo penalizaría el reporte honesto, lo opuesto al diseño anti-represalia del módulo.",
    recurring: false,
  },
  promotion_ready: {
    key: "promotion_ready",
    name: "Ascenso",
    bonusCents: 0,
    description: "Score >90 sostenido durante 4 semanas consecutivas. Habilita revisión de Líder (+5% Day Rate + auto-aprobación QC) -- el ascenso en sí sigue exigiendo aprobación admin.",
    computable: true,
    recurring: true,
  },
};

export const COMPUTABLE_BADGE_KEYS = (Object.values(BADGE_CATALOG) as BadgeDefinition[])
  .filter((b) => b.computable)
  .map((b) => b.key);

// ---------------------------------------------------------------------
// Elegibilidad — funciones puras, sin I/O.
// ---------------------------------------------------------------------

export interface ServiceGoldInput {
  completedServicesWithoutDisputeCount: number;
}

export function isEligibleForServiceGold(input: ServiceGoldInput): boolean {
  return input.completedServicesWithoutDisputeCount >= 50;
}

export interface FieldAuditForDetailMaster {
  /** Suma de los valores numéricos de field_audits.criteria para esta auditoría. */
  criteriaSum: number;
  /** 5 * cantidad de claves en criteria (el máximo posible para ESA auditoría). */
  criteriaMax: number;
}

const DETAIL_MASTER_MIN_RATIO = 23 / 25; // 0.92 -- literal del spec, expresado como razón para no depender de una escala fija de 25.
const DETAIL_MASTER_MIN_COUNT = 10;

/** ¿Cuántas de estas auditorías cuentan como "excelentes" (≥92%)? */
export function countExcellentAudits(audits: FieldAuditForDetailMaster[]): number {
  return audits.filter((a) => a.criteriaMax > 0 && a.criteriaSum / a.criteriaMax >= DETAIL_MASTER_MIN_RATIO).length;
}

export function isEligibleForDetailMaster(audits: FieldAuditForDetailMaster[]): boolean {
  return countExcellentAudits(audits) >= DETAIL_MASTER_MIN_COUNT;
}

const PROMOTION_READY_MIN_SCORE = 90;
const PROMOTION_READY_CONSECUTIVE_WEEKS = 4;

/**
 * ¿Las N semanas MÁS RECIENTES (ya ordenadas descendente por week_start)
 * tienen todas total_score > 90? No basta con 4 semanas buenas sueltas --
 * tienen que ser las últimas 4 consecutivas sin ninguna caída entremedio.
 */
export function isEligibleForPromotionReady(recentWeeklyScoresDesc: number[]): boolean {
  if (recentWeeklyScoresDesc.length < PROMOTION_READY_CONSECUTIVE_WEEKS) return false;
  return recentWeeklyScoresDesc
    .slice(0, PROMOTION_READY_CONSECUTIVE_WEEKS)
    .every((score) => score > PROMOTION_READY_MIN_SCORE);
}
