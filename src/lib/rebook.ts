/**
 * v8.3 E5.12 — Recompra frictionless.
 *
 * Lógica pura (sin I/O) para tres de los cuatro sub-features del punto 12
 * del plan ("reagendar desde galería (3 toques), recurrente de un toque,
 * cumpleaños con regalo configurable, recordatorio de recomendación del
 * líder"). El cuarto (recordatorio de recomendación del líder) no tiene
 * lógica pura propia -- es un texto de comunicación disparado por el mismo
 * cron de encuesta/reseña ya existente, ver route.ts.
 *
 * Deliberadamente NO reimplementa el motor de precios (calculatePrice /
 * applyPricingRules en src/lib/pricing.ts, src/lib/rules.ts). El flujo de
 * "reagendar" arma un prefill con los mismos inputs crudos de la cotización
 * original y lo envía a POST /api/quote -- el ÚNICO camino que recalcula
 * precio en servidor (invariante: nunca confiar en un precio del cliente).
 * Esto evita duplicar/derivar una segunda fuente de verdad de precio.
 */

/** Días de anticipación ofrecidos como accesos rápidos en la galería. */
export const REBOOK_QUICK_OFFSETS_DAYS = [7, 14, 30] as const;

export interface RebookDateOption {
  date: string; // YYYY-MM-DD
  label: string;
  offsetDays: number;
}

/**
 * Devuelve las fechas rápidas de reagendamiento a partir de "hoy" (Vancouver).
 * Puras: mismo input → mismo output, sin acceso a reloj real (todayISO se
 * inyecta) para que sea 100% testeable.
 */
export function computeRebookDateOptions(todayISO: string): RebookDateOption[] {
  const today = new Date(`${todayISO}T12:00:00Z`);
  return REBOOK_QUICK_OFFSETS_DAYS.map((offsetDays) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    const dateStr = d.toISOString().slice(0, 10);
    const weekday = d.toLocaleDateString("en-CA", { weekday: "long", timeZone: "UTC" });
    const label =
      offsetDays === 7
        ? `Next week (${weekday})`
        : offsetDays === 14
        ? `In 2 weeks (${weekday})`
        : `In a month (${weekday})`;
    return { date: dateStr, label, offsetDays };
  });
}

/** Día de la semana (0=Dom..6=Sáb) de una fecha YYYY-MM-DD, sin desfases de TZ. */
export function computeDayOfWeekFromDate(dateISO: string): number {
  return new Date(`${dateISO}T12:00:00Z`).getUTCDay();
}

export type ContractFrequency = "weekly" | "biweekly" | "monthly" | "quarterly";

/** Incremento aproximado en días por frecuencia de contrato recurrente. */
export const FREQUENCY_STEP_DAYS: Record<ContractFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
};

/**
 * Determina la próxima fecha de servicio recurrente para el flujo "1 toque".
 * Si next_scheduled_date sigue en el futuro (o es hoy), se respeta tal cual
 * (es la fuente de verdad del contrato). Si quedó en el pasado (el cliente
 * no reservó a tiempo, o el cron de generación de instancias falló), se
 * hace rollover hacia adelante por múltiplos de la frecuencia hasta superar
 * "hoy" -- nunca se ofrece una fecha ya pasada.
 */
export function computeNextRecurringDate(
  nextScheduledDateISO: string | null,
  todayISO: string,
  frequency: ContractFrequency
): string {
  const stepDays = FREQUENCY_STEP_DAYS[frequency];
  const today = new Date(`${todayISO}T12:00:00Z`);

  let candidate = nextScheduledDateISO
    ? new Date(`${nextScheduledDateISO}T12:00:00Z`)
    : new Date(today);

  if (!nextScheduledDateISO || candidate.getTime() < today.getTime()) {
    if (!nextScheduledDateISO) candidate = new Date(today);
    while (candidate.getTime() < today.getTime()) {
      candidate.setUTCDate(candidate.getUTCDate() + stepDays);
    }
  }

  return candidate.toISOString().slice(0, 10);
}

/** Monto de regalo de cumpleaños si no hay fila configurada en loyalty_settings. */
export const DEFAULT_BIRTHDAY_GIFT_CENTS = 1500;

export interface BirthdayGiftDecision {
  eligible: boolean;
  year: number;
}

/**
 * Decide si HOY corresponde otorgar el regalo de cumpleaños.
 * Elegible solo si (a) mes/día de hoy coincide con el mes/día de nacimiento,
 * y (b) no se ha otorgado ya el regalo este año calendario (idempotencia --
 * el cron corre diario, así que sin este chequeo se duplicaría el crédito
 * cada corrida del mismo día si no se marca de inmediato).
 */
export function computeBirthdayGiftEligibility(
  birthDateISO: string,
  todayISO: string,
  lastGiftYear: number | null
): BirthdayGiftDecision {
  const birth = new Date(`${birthDateISO}T12:00:00Z`);
  const today = new Date(`${todayISO}T12:00:00Z`);
  const currentYear = today.getUTCFullYear();

  const sameDay =
    birth.getUTCMonth() === today.getUTCMonth() && birth.getUTCDate() === today.getUTCDate();

  const alreadyGiftedThisYear = lastGiftYear === currentYear;

  return { eligible: sameDay && !alreadyGiftedThisYear, year: currentYear };
}
