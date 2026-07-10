/**
 * v8.3 E9 (D.9.2) — Ajuste automático de estimaciones (HHE y velocidad de
 * equipo). Funciones puras: reciben observaciones ya leídas de la base de
 * datos (HHE estimado vs. real por servicio) y devuelven SUGERENCIAS.
 *
 * Invariante duro: esta lib NUNCA aplica el cambio por sí sola (punto humano
 * B.3.2 — "Confirmar ajustes de precio/nómina... un clic, con impacto en
 * dólares mostrado"). Solo detecta, calcula el impacto y arma el mensaje que
 * el admin aprueba con un clic ("[Aplicar]"). La aplicación real (UPDATE a la
 * tabla HHE + snapshot con motivo obligatorio, invariante B.2.10) es un paso
 * separado y explícito fuera de esta lib.
 *
 * Regla de "sostenida 30 días" (D.9.2 literal: "desviación HHE >±15% x 30
 * días"): no basta con que el PROMEDIO se desvíe más del umbral — exigimos
 * que las observaciones cubran al menos `windowDays` de calendario Y que una
 * fracción alta de los días individuales (>= minConsistentFraction) también
 * se desvíe más allá de la mitad del umbral en la MISMA dirección. Esto evita
 * que un solo servicio atípico dispare la sugerencia.
 */

export interface HheObservation {
  serviceType: string;
  sqftBand: string;
  /** YYYY-MM-DD */
  date: string;
  /** HHE vigente en la tabla D.1 para este tipo+banda al momento del servicio */
  baselineHhe: number;
  /** HHE realmente consumida (T_out - T_in normalizado a "horas-hombre") */
  actualHhe: number;
}

export interface HheAdjustmentSuggestion {
  serviceType: string;
  sqftBand: string;
  currentHhe: number;
  suggestedHhe: number;
  /** Fracción firmada, ej. 0.125 = +12.5% */
  deviationPercent: number;
  /** Redondeado a entero para el mensaje, con signo, ej. 8 = "+8%" */
  impactPercent: number;
  observationDays: number;
  consistentFraction: number;
  message: string;
  requiresManualApproval: true;
}

export interface HheAdjustmentOptions {
  windowDays?: number;
  thresholdPercent?: number;
  /** Fracción mínima de observaciones individuales que deben confirmar la desviación */
  minConsistentFraction?: number;
  /** Granularidad de redondeo de la tabla D.1 (incrementos de 0.5 hr) */
  roundingIncrement?: number;
}

const DEFAULT_OPTIONS: Required<HheAdjustmentOptions> = {
  windowDays: 30,
  thresholdPercent: 0.15,
  minConsistentFraction: 0.7,
  roundingIncrement: 0.5,
};

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000;
}

function roundToIncrement(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

function groupKey(serviceType: string, sqftBand: string): string {
  return `${serviceType}::${sqftBand}`;
}

/**
 * Analiza un grupo (mismo tipo de servicio + banda ft²) de observaciones
 * dentro de la ventana [asOfDate - windowDays, asOfDate] y determina si la
 * desviación es sostenida según la regla de arriba.
 */
function analyzeGroup(
  observations: HheObservation[],
  asOfDate: string,
  opts: Required<HheAdjustmentOptions>
): {
  inWindow: HheObservation[];
  observationDays: number;
  averageBaseline: number;
  averageActual: number;
  deviationPercent: number;
  consistentFraction: number;
  isSustained: boolean;
} | null {
  const inWindow = observations.filter((o) => daysBetween(o.date, asOfDate) <= opts.windowDays);
  if (inWindow.length === 0) return null;

  const dates = inWindow.map((o) => o.date).sort();
  const observationDays = daysBetween(dates[0], asOfDate);

  const averageBaseline = inWindow.reduce((s, o) => s + o.baselineHhe, 0) / inWindow.length;
  const averageActual = inWindow.reduce((s, o) => s + o.actualHhe, 0) / inWindow.length;
  const deviationPercent = averageBaseline > 0 ? (averageActual - averageBaseline) / averageBaseline : 0;

  const direction = Math.sign(deviationPercent);
  const confirming = inWindow.filter((o) => {
    if (o.baselineHhe <= 0) return false;
    const d = (o.actualHhe - o.baselineHhe) / o.baselineHhe;
    return Math.sign(d) === direction && Math.abs(d) >= opts.thresholdPercent / 2;
  });
  const consistentFraction = confirming.length / inWindow.length;

  const isSustained =
    observationDays >= opts.windowDays &&
    Math.abs(deviationPercent) >= opts.thresholdPercent &&
    consistentFraction >= opts.minConsistentFraction;

  return { inWindow, observationDays, averageBaseline, averageActual, deviationPercent, consistentFraction, isSustained };
}

/**
 * Detecta, por tipo de servicio + banda ft², desviaciones sostenidas de HHE
 * y devuelve sugerencias de ajuste listas para mostrar con un botón
 * "[Aplicar]". Nunca aplica el cambio.
 */
export function detectHheAdjustmentSuggestions(
  observations: HheObservation[],
  asOfDate: string,
  options?: HheAdjustmentOptions
): HheAdjustmentSuggestion[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const groups = new Map<string, HheObservation[]>();
  for (const o of observations) {
    const key = groupKey(o.serviceType, o.sqftBand);
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }

  const suggestions: HheAdjustmentSuggestion[] = [];

  for (const [, groupObservations] of Array.from(groups.entries())) {
    const { serviceType, sqftBand } = groupObservations[0];
    const analysis = analyzeGroup(groupObservations, asOfDate, opts);
    if (!analysis || !analysis.isSustained) continue;

    const currentHhe = groupObservations[groupObservations.length - 1].baselineHhe;
    const suggestedHhe = roundToIncrement(analysis.averageActual, opts.roundingIncrement);
    if (suggestedHhe === currentHhe) continue; // el redondeo puede anular la diferencia

    const impactPercent = Math.round(((suggestedHhe - currentHhe) / currentHhe) * 100);
    const sign = impactPercent >= 0 ? "+" : "";

    suggestions.push({
      serviceType,
      sqftBand,
      currentHhe,
      suggestedHhe,
      deviationPercent: analysis.deviationPercent,
      impactPercent,
      observationDays: analysis.observationDays,
      consistentFraction: analysis.consistentFraction,
      message: `¿Ajustar HHE de ${serviceType} ${sqftBand} de ${currentHhe} a ${suggestedHhe}? Impacto ${sign}${impactPercent}%. [Aplicar]`,
      requiresManualApproval: true,
    });
  }

  return suggestions.sort((a, b) => a.serviceType.localeCompare(b.serviceType) || a.sqftBand.localeCompare(b.sqftBand));
}

// ------------------------------------------------------------
// Equipo consistentemente más rápido (misma lógica, otro umbral/dirección)
// D.9.2: "equipo 20% más rápido consistente → sugerir servicios complejos o
// reducir N".
// ------------------------------------------------------------

export interface TeamSpeedObservation {
  teamLabel: string;
  /** YYYY-MM-DD */
  date: string;
  /** Tiempo de bloqueo estimado (T_bloqueo, D.3) */
  estimatedHours: number;
  /** Tiempo real tomado */
  actualHours: number;
}

export interface TeamSpeedSuggestion {
  teamLabel: string;
  averageSpeedupPercent: number;
  observationDays: number;
  consistentFraction: number;
  message: string;
  requiresManualApproval: true;
}

const TEAM_SPEED_THRESHOLD = 0.2; // 20%, invariante D.9.2

export function detectTeamSpeedSuggestions(
  observations: TeamSpeedObservation[],
  asOfDate: string,
  options?: Pick<HheAdjustmentOptions, "windowDays" | "minConsistentFraction">
): TeamSpeedSuggestion[] {
  const opts = {
    windowDays: options?.windowDays ?? DEFAULT_OPTIONS.windowDays,
    thresholdPercent: TEAM_SPEED_THRESHOLD,
    minConsistentFraction: options?.minConsistentFraction ?? DEFAULT_OPTIONS.minConsistentFraction,
    roundingIncrement: DEFAULT_OPTIONS.roundingIncrement,
  };

  const groups = new Map<string, TeamSpeedObservation[]>();
  for (const o of observations) {
    const list = groups.get(o.teamLabel);
    if (list) list.push(o);
    else groups.set(o.teamLabel, [o]);
  }

  const suggestions: TeamSpeedSuggestion[] = [];

  for (const [teamLabel, groupObservations] of Array.from(groups.entries())) {
    const asHhe: HheObservation[] = groupObservations.map((o) => ({
      serviceType: teamLabel,
      sqftBand: "n/a",
      date: o.date,
      baselineHhe: o.estimatedHours,
      actualHhe: o.actualHours,
    }));
    const analysis = analyzeGroup(asHhe, asOfDate, opts);
    if (!analysis) continue;

    // "Más rápido" = actual consistentemente MENOR al estimado.
    const isFasterSustained =
      analysis.observationDays >= opts.windowDays &&
      analysis.deviationPercent <= -opts.thresholdPercent &&
      analysis.consistentFraction >= opts.minConsistentFraction;
    if (!isFasterSustained) continue;

    const averageSpeedupPercent = Math.round(Math.abs(analysis.deviationPercent) * 100);

    suggestions.push({
      teamLabel,
      averageSpeedupPercent,
      observationDays: analysis.observationDays,
      consistentFraction: analysis.consistentFraction,
      message: `Equipo ${teamLabel} completa servicios ${averageSpeedupPercent}% más rápido que lo estimado, de forma sostenida. ¿Asignar servicios más complejos o reducir N? [Revisar]`,
      requiresManualApproval: true,
    });
  }

  return suggestions.sort((a, b) => a.teamLabel.localeCompare(b.teamLabel));
}
