/**
 * v8.3 G.2 — Simulador de Escenarios ("Blast Radius").
 *
 * Tres simuladores "What If" que el admin puede ejecutar antes de tomar
 * decisiones operativas o estratégicas:
 *
 *   (a) Staffing — ¿Cuántos servicios más puedo tomar si agrego +N equipos?
 *   (b) Pricing  — ¿Impacto de +X% en precio sobre conversión e ingreso neto?
 *   (c) Blast Radius — Si un líder renuncia hoy, ¿cuántas órdenes están en
 *       riesgo y cuál es la pérdida proyectada?
 *
 * Usa datos reales del shadow-ledger (márgenes por orden vía
 * replayOrderBalance) y de la agenda de despacho. Funciones puras: reciben
 * datos ya consultados, nunca tocan la DB directamente.
 *
 * Los resultados del Blast Radius incluyen un borrador de plan de
 * contingencia — no es un documento final, es una estructura de datos que el
 * frontend renderiza como punto de partida para que el admin complete.
 */

import type { ReplayedOrderBalance } from "@/lib/shadow-ledger";
import { replayOrderBalance } from "@/lib/shadow-ledger";
import type { DispatchCandidate } from "@/lib/dispatch-team";

// ---------------------------------------------------------------------------
// Tipos comunes
// ---------------------------------------------------------------------------

/** Moneda en cents para todas las funciones. */
type Cents = number;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatCurrencyCents(cents: Cents): string {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// (a) Simulador de Staffing
// ═══════════════════════════════════════════════════════════════════════════

export interface StaffingSimInput {
  /** Equipos actualmente activos. */
  currentTeamCount: number;
  /** Servicios completados en los últimos 30 días. */
  servicesCompletedLast30Days: number;
  /** Servicios rechazados o no tomados por falta de capacidad (ventana 30 días). */
  servicesDeclinedCapacityLast30Days: number;
  /** Ingreso promedio por servicio en cents (neto, shadow-ledger). */
  avgRevenuePerServiceCents: Cents;
  /** Margen neto promedio por servicio en cents. */
  avgNetProfitPerServiceCents: Cents;
  /** HHE promedio por servicio (horas). */
  avgHhePerService: number;
  /** Horas operativas disponibles por equipo por día. */
  hoursPerTeamPerDay: number;
  /** Días hábiles por mes. */
  workingDaysPerMonth: number;
}

export interface StaffingSimResult {
  /** Escenarios simulados para +1, +2, ..., +maxDelta equipos. */
  scenarios: StaffingScenario[];
  /** Recomendación textual basada en saturación de demanda. */
  recommendation: string;
}

export interface StaffingScenario {
  additionalTeams: number;
  totalTeams: number;
  /** Servicios adicionales que se podrían absorber por mes. */
  estimatedAdditionalServicesPerMonth: number;
  /** Ingreso adicional proyectado (cents). */
  projectedAdditionalRevenueCents: Cents;
  /** Ganancia neta adicional proyectada (cents). */
  projectedAdditionalProfitCents: Cents;
  /** true si la demanda actual justifica este crecimiento. */
  demandSaturated: boolean;
}

/**
 * Simula el impacto de agregar equipos adicionales.
 *
 * Fórmula base: capacidad_mensual_por_equipo = hoursPerTeamPerDay ×
 * workingDaysPerMonth / avgHhePerService. Servicios adicionales posibles =
 * min(capacidad de los nuevos equipos, demanda insatisfecha).
 *
 * @param input — datos operativos actuales.
 * @param maxAdditionalTeams — cuántos escenarios generar (default 3: +1, +2, +3).
 */
export function simulateStaffing(
  input: StaffingSimInput,
  maxAdditionalTeams = 3
): StaffingSimResult {
  const capacityPerTeam =
    (input.hoursPerTeamPerDay * input.workingDaysPerMonth) / input.avgHhePerService;

  const unmetDemand = Math.max(0, input.servicesDeclinedCapacityLast30Days);
  const scenarios: StaffingScenario[] = [];

  for (let delta = 1; delta <= maxAdditionalTeams; delta++) {
    const additionalCapacity = Math.round(delta * capacityPerTeam);
    const additionalServices = Math.min(additionalCapacity, unmetDemand);
    const demandSaturated = additionalServices < additionalCapacity;

    scenarios.push({
      additionalTeams: delta,
      totalTeams: input.currentTeamCount + delta,
      estimatedAdditionalServicesPerMonth: additionalServices,
      projectedAdditionalRevenueCents: Math.round(
        additionalServices * input.avgRevenuePerServiceCents
      ),
      projectedAdditionalProfitCents: Math.round(
        additionalServices * input.avgNetProfitPerServiceCents
      ),
      demandSaturated,
    });
  }

  const bestScenario = scenarios[scenarios.length - 1];
  const recommendation = unmetDemand === 0
    ? "No hay demanda insatisfecha registrada en los últimos 30 días. Agregar equipos sin demanda nueva diluiría el margen por equipo."
    : bestScenario.demandSaturated
      ? `Con +${bestScenario.additionalTeams} equipo(s) ya se cubre toda la demanda insatisfecha conocida (${unmetDemand} servicios/mes). Más equipos no agregarían ingresos.`
      : `La demanda insatisfecha (${unmetDemand} servicios/mes) supera la capacidad adicional incluso con +${maxAdditionalTeams} equipos. Considere un crecimiento más agresivo o revise restricciones de zona.`;

  return { scenarios, recommendation };
}

// ═══════════════════════════════════════════════════════════════════════════
// (b) Simulador de Pricing
// ═══════════════════════════════════════════════════════════════════════════

export interface PricingSimInput {
  /** Precio promedio actual por servicio en cents. */
  currentAvgPriceCents: Cents;
  /** Volumen mensual de servicios actual. */
  currentMonthlyVolume: number;
  /** Margen de contribución actual (%). */
  currentContributionMarginPercent: number;
  /** Elasticidad precio-demanda estimada (coeficiente). Valores típicos:
   *  -0.3 a -0.8 para servicios de limpieza residencial (inelásticos). */
  priceElasticity: number;
  /** Costo variable por servicio en cents (no cambia con el precio). */
  variableCostPerServiceCents: Cents;
}

export interface PricingSimResult {
  scenarios: PricingScenario[];
  /** Precio que maximiza el ingreso neto según esta elasticidad. */
  optimalPriceCents: Cents | null;
  recommendation: string;
}

export interface PricingScenario {
  priceChangePercent: number;
  newPriceCents: Cents;
  /** Volumen proyectado después del cambio de precio. */
  projectedVolume: number;
  /** Ingreso bruto proyectado (cents). */
  projectedRevenueCents: Cents;
  /** Ingreso neto proyectado (revenue - variableCosts). */
  projectedNetIncomeCents: Cents;
  /** Cambio en ingreso neto vs. actual. */
  netIncomeDeltaCents: Cents;
  netIncomeDeltaPercent: number;
}

/**
 * Simula el impacto de cambios de precio en conversión e ingreso neto.
 *
 * Fórmula: Q_nuevo = Q_actual × (1 + elasticidad × ΔP%). Ingreso neto =
 * (P_nuevo - costo_variable) × Q_nuevo. La elasticidad es negativa (subir
 * precio reduce volumen), pero se pasa como número negativo típicamente.
 *
 * Genera escenarios desde -20% hasta +30% en incrementos de 5pp.
 *
 * @param input — precios y volúmenes actuales.
 */
export function simulatePricing(input: PricingSimInput): PricingSimResult {
  const deltas = [-20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30];
  const scenarios: PricingScenario[] = [];

  let bestNetIncome = -Infinity;
  let optimalPriceCents: Cents | null = null;

  for (const deltaPct of deltas) {
    const deltaRatio = deltaPct / 100;
    const newPriceCents = Math.round(input.currentAvgPriceCents * (1 + deltaRatio));

    // Q_nuevo = Q_actual × (1 + elasticidad × ΔP%)
    const volumeMultiplier = 1 + input.priceElasticity * deltaRatio;
    const projectedVolume = Math.max(0, Math.round(input.currentMonthlyVolume * volumeMultiplier));

    const projectedRevenueCents = projectedVolume * newPriceCents;
    const projectedNetIncomeCents = projectedVolume * (newPriceCents - input.variableCostPerServiceCents);

    // Baseline net income
    const baselineNetIncomeCents =
      input.currentMonthlyVolume * (input.currentAvgPriceCents - input.variableCostPerServiceCents);

    const netIncomeDeltaCents = projectedNetIncomeCents - baselineNetIncomeCents;
    const netIncomeDeltaPercent =
      baselineNetIncomeCents !== 0
        ? round2((netIncomeDeltaCents / baselineNetIncomeCents) * 100)
        : 0;

    scenarios.push({
      priceChangePercent: deltaPct,
      newPriceCents,
      projectedVolume,
      projectedRevenueCents,
      projectedNetIncomeCents,
      netIncomeDeltaCents,
      netIncomeDeltaPercent,
    });

    if (projectedNetIncomeCents > bestNetIncome) {
      bestNetIncome = projectedNetIncomeCents;
      optimalPriceCents = newPriceCents;
    }
  }

  const currentScenario = scenarios.find((s) => s.priceChangePercent === 0)!;

  const recommendation =
    optimalPriceCents !== null && optimalPriceCents !== input.currentAvgPriceCents
      ? `Precio óptimo estimado: ${formatCurrencyCents(optimalPriceCents)} (ingreso neto: ${formatCurrencyCents(bestNetIncome)}/mes vs. ${formatCurrencyCents(currentScenario.projectedNetIncomeCents)}/mes actual). Nota: este modelo asume elasticidad constante — valide con un A/B test antes de aplicar.`
      : "El precio actual ya es óptimo según la elasticidad provista. Revise si la elasticidad estimada refleja el mercado real.";

  return { scenarios, optimalPriceCents, recommendation };
}

// ═══════════════════════════════════════════════════════════════════════════
// (c) Blast Radius — Simulador de renuncia de líder
// ═══════════════════════════════════════════════════════════════════════════

export interface BlastRadiusInput {
  /** ID o nombre del líder que se simula como ausente. */
  leaderId: string;
  leaderName: string;
  /** Órdenes futuras (próximos 5-7 días) asignadas a equipos que este líder supervisa. */
  atRiskOrders: AtRiskOrder[];
  /** Candidatos disponibles para reemplazo (supervisores activos). */
  availableSupervisors: DispatchCandidate[];
  /** Margen promedio por orden en cents (para calcular pérdida). */
  avgMarginPerOrderCents: Cents;
}

export interface AtRiskOrder {
  orderId: string;
  serviceDate: string;
  zone: string;
  clientName: string;
  teamSize: number;
  /** Ingreso esperado de esta orden en cents. */
  expectedRevenueCents: Cents;
}

export interface BlastRadiusResult {
  leaderId: string;
  leaderName: string;
  atRiskOrderCount: number;
  atRiskOrders: AtRiskOrder[];
  projectedLossCents: Cents;
  projectedLossFormatted: string;
  /** Supervisores que podrían absorber las órdenes. */
  replacementCandidates: ReplacementCandidate[];
  /** Borrador de plan de contingencia. */
  contingencyPlan: ContingencyPlanDraft;
}

export interface ReplacementCandidate {
  supervisorId: string;
  supervisorName: string;
  trustLevel: string;
  /** Cuántas órdenes de las en riesgo podría cubrir este supervisor (misma zona, disponibilidad). */
  ordersCoverable: number;
  /** Zonas en común con las órdenes en riesgo. */
  zoneOverlap: string[];
}

export interface ContingencyPlanDraft {
  summary: string;
  steps: ContingencyStep[];
  estimatedRecoveryDays: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface ContingencyStep {
  order: number;
  action: string;
  timeframe: string;
  owner: string;
}

/**
 * Simula el "blast radius" si un líder de equipo renuncia o queda
 * incapacitado hoy. Calcula órdenes en riesgo, pérdida proyectada y
 * candidatos de reemplazo, y genera un borrador de plan de contingencia.
 *
 * @param input — líder ausente, órdenes en riesgo, supervisores disponibles.
 */
export function simulateBlastRadius(input: BlastRadiusInput): BlastRadiusResult {
  const atRiskOrders = input.atRiskOrders;
  const projectedLossCents: Cents = atRiskOrders.reduce(
    (sum, _o) => sum + input.avgMarginPerOrderCents,
    0
  );

  // Buscar supervisores que puedan cubrir estas órdenes
  const replacementCandidates: ReplacementCandidate[] = input.availableSupervisors
    .filter((s) => s.role === "supervisor" && s.id !== input.leaderId)
    .map((s) => {
      const zones = new Set(atRiskOrders.map((o) => o.zone));
      const zoneOverlap = (s.homeZone && zones.has(s.homeZone))
        ? [s.homeZone]
        : Array.from(zones).filter((z) => z === s.homeZone);

      const ordersCoverable = zoneOverlap.length > 0
        ? atRiskOrders.filter((o) => zoneOverlap.includes(o.zone)).length
        : Math.ceil(atRiskOrders.length * 0.5); // sin match de zona, asume 50% cubrible

      return {
        supervisorId: s.id,
        supervisorName: s.id,
        trustLevel: s.trustLevel,
        ordersCoverable,
        zoneOverlap,
      };
    })
    .sort((a, b) => b.ordersCoverable - a.ordersCoverable);

  // Generar plan de contingencia
  const riskLevel: ContingencyPlanDraft["riskLevel"] =
    atRiskOrders.length === 0 ? "low"
    : atRiskOrders.length <= 3 ? "medium"
    : atRiskOrders.length <= 8 ? "high"
    : "critical";

  const emergencyContactSteps: ContingencyStep[] = [
    {
      order: 1,
      action: `Notificar al dueño y a RRHH sobre la ausencia de ${input.leaderName}.`,
      timeframe: "Inmediato (0-15 min)",
      owner: "Sistema → Admin",
    },
    {
      order: 2,
      action: `Revisar ${atRiskOrders.length} órdenes en riesgo para los próximos 5-7 días.`,
      timeframe: "15-30 min",
      owner: "Admin",
    },
    ...(replacementCandidates.length > 0
      ? [
          {
            order: 3,
            action: `Reasignar órdenes críticas a supervisores disponibles: ${replacementCandidates
              .slice(0, 3)
              .map((c) => `${c.supervisorId} (${c.trustLevel}, ${c.ordersCoverable} órdenes)`)
              .join(", ")}.`,
            timeframe: "30 min - 2h",
            owner: "Admin + Dispatch",
          },
        ]
      : [
          {
            order: 3,
            action:
              "No hay supervisores disponibles con match de zona. Evaluar: (A) promover un cleaner élite temporalmente, (B) contactar líder de zona vecina, (C) reprogramar órdenes no urgentes.",
            timeframe: "30 min - 2h",
            owner: "Admin",
          },
        ]),
    {
      order: replacementCandidates.length > 0 ? 4 : 4,
      action:
        "Notificar a clientes afectados con mensaje proactivo: «Por razones operativas, su servicio puede tener un nuevo líder de equipo. La calidad no cambia.»",
      timeframe: "1-3h",
      owner: "Admin + Comunicaciones",
    },
    {
      order: replacementCandidates.length > 0 ? 5 : 5,
      action: `Iniciar búsqueda de reemplazo permanente para ${input.leaderName}. Publicar en canales internos y externos.`,
      timeframe: "24-48h",
      owner: "RRHH",
    },
    {
      order: replacementCandidates.length > 0 ? 6 : 6,
      action: `Revisar plan de sucesión del equipo afectado — actualizar ${input.leaderName} → reemplazo en organigrama.`,
      timeframe: "48-72h",
      owner: "Admin",
    },
  ];

  const contingencyPlan: ContingencyPlanDraft = {
    summary:
      atRiskOrders.length === 0
        ? `La ausencia de ${input.leaderName} no pone ninguna orden en riesgo inmediato. Sin acción urgente requerida.`
        : `${atRiskOrders.length} órdenes en riesgo inmediato. Pérdida proyectada: ${formatCurrencyCents(projectedLossCents)}. Nivel de riesgo: ${riskLevel}.`,
    steps: emergencyContactSteps,
    estimatedRecoveryDays:
      riskLevel === "low" ? 1 : riskLevel === "medium" ? 3 : riskLevel === "high" ? 5 : 7,
    riskLevel,
  };

  return {
    leaderId: input.leaderId,
    leaderName: input.leaderName,
    atRiskOrderCount: atRiskOrders.length,
    atRiskOrders,
    projectedLossCents,
    projectedLossFormatted: formatCurrencyCents(projectedLossCents),
    replacementCandidates,
    contingencyPlan,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilidad compuesta: Obtener el balance real de una orden desde el ledger
// ═══════════════════════════════════════════════════════════════════════════

export { replayOrderBalance };
export type { ReplayedOrderBalance };
