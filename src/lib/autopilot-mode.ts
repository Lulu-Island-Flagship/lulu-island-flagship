/**
 * v8.3 E0.11 — Flag global Autopilot/Manual.
 *
 * "Manual = el sistema sugiere y espera (timeout 10 min → Fallback a
 * Autopilot). Autopilot = corre solo con reglas pre-aprobadas."
 *
 * DISEÑO HONESTO: cada módulo de excepción ya tiene su propio timer de 10
 * min con auto-decisión al vencer (dispatch-fallback.ts, safety-abort.ts,
 * etc.) -- eso ya es, en la práctica, comportamiento Autopilot, y corre
 * siempre así hoy sin importar este flag. Esta función NO reescribe esa
 * lógica interna; clasifica el modo operativo global para que la UI (panel
 * de flags, dashboard) lo muestre de forma visible y consistente, en vez de
 * ser un valor de base de datos sin efecto perceptible.
 */

export const AUTOPILOT_MODE_FLAG_NAME = "e0_autopilot_mode";

export type OperatingMode = "autopilot" | "manual";

export function resolveOperatingMode(flagActivo: boolean): OperatingMode {
  return flagActivo ? "autopilot" : "manual";
}

export interface OperatingModeDescription {
  mode: OperatingMode;
  label: string;
  explanation: string;
}

const MODE_DESCRIPTIONS: Record<OperatingMode, OperatingModeDescription> = {
  autopilot: {
    mode: "autopilot",
    label: "Autopilot",
    explanation: "El sistema decide solo con reglas pre-aprobadas, sin esperar revisión humana.",
  },
  manual: {
    mode: "manual",
    label: "Manual",
    explanation:
      "El sistema sugiere y espera. Sigue auto-decidiendo a los 10 min por Fallback si nadie responde, pero lo marca como pendiente de revisión humana mientras tanto.",
  },
};

export function describeOperatingMode(flagActivo: boolean): OperatingModeDescription {
  return MODE_DESCRIPTIONS[resolveOperatingMode(flagActivo)];
}
