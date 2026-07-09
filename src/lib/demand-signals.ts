/**
 * v8.3 E10 (D.10.5) — Análisis de demanda externa. Función pura: recibe
 * señales ya obtenidas (clima, calendario) y devuelve el multiplicador
 * combinado + si conviene disparar una campaña. NO llama APIs externas
 * (eso vive en un adaptador aparte, fuera del alcance de esta función).
 *
 * Multiplicadores literales del spec:
 *   clima (lluvia) +30% | eventos locales -20% | vacaciones -30% |
 *   festivos (Día de la Madre +40%, Navidad +50%) | polen (Eco/HEPA) +25%
 */

export interface DemandSignals {
  isRainy?: boolean;
  hasLocalEvent?: boolean;
  isSchoolVacation?: boolean;
  holiday?: "mothers_day" | "christmas" | null;
  highPollen?: boolean;
}

export interface DemandMultiplierResult {
  multiplier: number; // 1.0 = sin cambio
  appliedFactors: string[];
}

export function calculateDemandMultiplier(signals: DemandSignals): DemandMultiplierResult {
  let multiplier = 1.0;
  const appliedFactors: string[] = [];

  if (signals.isRainy) {
    multiplier *= 1.3;
    appliedFactors.push("lluvia +30%");
  }
  if (signals.hasLocalEvent) {
    multiplier *= 0.8;
    appliedFactors.push("evento local -20%");
  }
  if (signals.isSchoolVacation) {
    multiplier *= 0.7;
    appliedFactors.push("vacaciones escolares -30%");
  }
  if (signals.holiday === "mothers_day") {
    multiplier *= 1.4;
    appliedFactors.push("Día de la Madre +40%");
  }
  if (signals.holiday === "christmas") {
    multiplier *= 1.5;
    appliedFactors.push("Navidad +50%");
  }
  if (signals.highPollen) {
    multiplier *= 1.25;
    appliedFactors.push("polen alto (Eco/HEPA) +25%");
  }

  return { multiplier: Math.round(multiplier * 100) / 100, appliedFactors };
}

export type SeasonalCampaign =
  | "spring_refresh"
  | "summer_prep"
  | "back_to_routine"
  | "holiday_ready"
  | "post_holiday_reset";

export interface CampaignTriggerDecision {
  campaign: SeasonalCampaign;
  shouldTrigger: boolean;
  multiplier: number;
  reason: string;
}

const TRIGGER_THRESHOLD = 1.1; // multiplicador minimo para adelantar/confirmar el disparo

/**
 * La fecha de la campaña es sugerencia (D.10.4): el disparo real se modula
 * por la demanda observada. Un multiplicador >= 1.1 confirma o incluso
 * adelanta el disparo; por debajo, se mantiene en espera aunque ya sea "su"
 * fecha sugerida (el spec no obliga a disparar en fecha fija).
 */
export function decideCampaignTrigger(
  campaign: SeasonalCampaign,
  signals: DemandSignals,
  isSuggestedDateReached: boolean
): CampaignTriggerDecision {
  const { multiplier, appliedFactors } = calculateDemandMultiplier(signals);

  if (multiplier >= TRIGGER_THRESHOLD) {
    return {
      campaign,
      shouldTrigger: true,
      multiplier,
      reason: `Demanda favorable (${appliedFactors.join(", ") || "sin factores"}): dispara aunque no sea la fecha sugerida.`,
    };
  }

  if (isSuggestedDateReached && multiplier >= 1.0) {
    return {
      campaign,
      shouldTrigger: true,
      multiplier,
      reason: "Fecha sugerida alcanzada y demanda neutral: dispara por calendario.",
    };
  }

  return {
    campaign,
    shouldTrigger: false,
    multiplier,
    reason: `Demanda insuficiente (${multiplier}x) y fecha sugerida no alcanzada o desfavorable: en espera.`,
  };
}
