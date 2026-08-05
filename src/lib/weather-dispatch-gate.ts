import {
  type GetForecastResult,
} from "./weather-provider";
import {
  type WeatherExceptionDecision,
  classifyWeatherException,
} from "./weather-exception";
import {
  resolveOperatingMode,
  type OperatingMode,
} from "./autopilot-mode";
import {
  type SystemEvent,
  type ClimaAlertaSeveraPayload,
  type ClimaLluviaBufferPayload,
  buildSystemEvent,
} from "./events";

/**
 * v8.3 C.4 — Gate Clima → Despacho: conecta weather-provider.ts,
 * weather-exception.ts y autopilot-mode.ts para aplicar reglas automáticas
 * de clima sobre el despacho.
 *
 * Dos reglas independientes (spec literal):
 *
 *   1. ALERTA SEVERA (nevada, viento fuerte, etc.) → pausa autopilot en la
 *      zona afectada. El despacho pasa a modo manual para esa zona; las
 *      órdenes quedan pendientes de revisión humana. Se emite
 *      `clima.alerta_severa`.
 *
 *   2. LLUVIA → +15 minutos de buffer al T_bloqueo estimado para todas las
 *      órdenes activas en la zona. Las órdenes no se cancelan ni se pausan,
 *      solo se ajusta el tiempo de bloqueo para absorber tráfico/retrasos
 *      por lluvia. Se emite `clima.lluvia_buffer`.
 *
 * Responsabilidades:
 *   - weather-provider.ts: obtiene el pronóstico (hoy stub, mañana API real).
 *   - weather-exception.ts: clasifica la excepción (reschedule vs safe_abort).
 *   - autopilot-mode.ts: define el modo operativo global.
 *   - weather-dispatch-gate.ts: ORQUESTA las tres piezas y emite eventos.
 */

// ── Constantes ───────────────────────────────────────────────────────────────

/** Minutos agregados a T_bloqueo por lluvia (spec: +15 min). */
export const LLUVIA_BUFFER_MINUTOS = 15;

/** Condiciones consideradas "severas" para pausar autopilot. */
const CONDICIONES_SEVERAS = new Set([
  "snow",
  "heavy_snow",
  "blizzard",
  "freezing_rain",
  "ice_storm",
  "high_wind",
  "storm",
  "thunderstorm",
  "hail",
  "extreme_heat",
]);

/** Condiciones de lluvia que agregan buffer sin pausar autopilot. */
const CONDICIONES_LLUVIA = new Set([
  "rain",
  "light_rain",
  "showers",
  "drizzle",
  "heavy_rain",
]);

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Nivel de alerta meteorológica. */
export type WeatherAlertLevel = "warning" | "watch" | "advisory";

/** Resultado de la evaluación de clima para una zona de despacho. */
export interface WeatherDispatchDecision {
  /** Zona evaluada. */
  zona: string;
  /** Fecha del servicio evaluada. */
  fechaServicio: string;
  /** Condición climática detectada (null si no configurada). */
  condicion: string | null;
  /** true si hay una alerta severa activa. */
  alertaSevera: boolean;
  /** true si hay lluvia que requiere buffer adicional. */
  lluviaActiva: boolean;
  /** true si el autopilot debe pausarse en esta zona. */
  pausarAutopilot: boolean;
  /** Minutos de buffer adicionales para T_bloqueo (0 si no aplica). */
  bufferTbloqueoMinutos: number;
  /** Eventos emitidos (vacío si no hay cambios). */
  eventos: SystemEvent[];
  /** Mensaje legible para el admin/dashboard. */
  mensaje: string;
}

// ── Detección de condiciones ────────────────────────────────────────────────

/**
 * Determina si la condición climática es severa (pausa autopilot).
 * El mapeo de condiciones se basa en las categorías estándar de Environment
 * Canada — se normalizan a snake_case para comparación.
 */
function esCondicionSevera(condition: string | null): boolean {
  if (!condition) return false;
  const normalized = condition.toLowerCase().replace(/\s+/g, "_");
  return CONDICIONES_SEVERAS.has(normalized);
}

/**
 * Determina si la condición climática es lluvia (buffer T_bloqueo).
 */
function esLluvia(condition: string | null): boolean {
  if (!condition) return false;
  const normalized = condition.toLowerCase().replace(/\s+/g, "_");
  return CONDICIONES_LLUVIA.has(normalized);
}

// ── Evaluación principal ────────────────────────────────────────────────────

/**
 * Evalúa las condiciones climáticas para una zona y decide si se debe
 * pausar el autopilot y/o agregar buffer de lluvia a T_bloqueo.
 *
 * Esta es la función principal del módulo — el cron de despacho la llama
 * para cada zona antes de ejecutar la asignación.
 *
 * @param zona — nombre de la zona (ej. "Richmond Central").
 * @param fechaServicio — fecha del servicio a evaluar (YYYY-MM-DD).
 * @param forecastResult — resultado de weather-provider.getForecast().
 * @param autopilotActivo — si el flag global de autopilot está activo.
 * @param ordenesActivas — IDs de órdenes activas en la zona para el buffer de lluvia.
 * @returns WeatherDispatchDecision con las acciones a tomar.
 */
export function evaluarClimaParaDespacho(
  zona: string,
  fechaServicio: string,
  forecastResult: GetForecastResult,
  autopilotActivo: boolean,
  ordenesActivas?: string[],
): WeatherDispatchDecision {
  const eventos: SystemEvent[] = [];
  const correlationId = crypto.randomUUID();
  const condicion = forecastResult.condition;
  const isAdverse = forecastResult.isAdverse === true;

  const alertaSevera = isAdverse && esCondicionSevera(condicion);
  const lluviaActiva = esLluvia(condicion);
  const pausarAutopilot = alertaSevera && autopilotActivo;

  // Regla 1: Alerta severa → pausar autopilot
  if (pausarAutopilot) {
    const nivel: WeatherAlertLevel = condicion?.includes("warning")
      ? "warning"
      : condicion?.includes("watch")
        ? "watch"
        : "advisory";

    const payload: ClimaAlertaSeveraPayload = {
      zona,
      condicion: condicion ?? "desconocida",
      nivel,
      pausa_autopilot: true,
      fecha_servicio: fechaServicio,
    };

    eventos.push(
      buildSystemEvent(
        "clima.alerta_severa",
        zona,
        correlationId,
        payload,
      ),
    );
  }

  // Regla 2: Lluvia → +15 min buffer T_bloqueo
  if (lluviaActiva && ordenesActivas && ordenesActivas.length > 0) {
    const payload: ClimaLluviaBufferPayload = {
      zona,
      buffer_minutos: LLUVIA_BUFFER_MINUTOS,
      ordenes_afectadas: ordenesActivas,
      fecha_servicio: fechaServicio,
    };

    eventos.push(
      buildSystemEvent(
        "clima.lluvia_buffer",
        zona,
        correlationId,
        payload,
      ),
    );
  }

  // Mensaje legible
  let mensaje: string;
  if (forecastResult.status === "not_configured") {
    mensaje = `Clima no configurado para ${zona} el ${fechaServicio}. Sin detección automática.`;
  } else if (pausarAutopilot) {
    mensaje = `⛔ ALERTA SEVERA en ${zona}: "${condicion}". Autopilot pausado. Órdenes pendientes de revisión humana.`;
  } else if (lluviaActiva) {
    const ordenes = ordenesActivas?.length ?? 0;
    mensaje = `🌧️ Lluvia en ${zona}: +${LLUVIA_BUFFER_MINUTOS} min buffer en T_bloqueo para ${ordenes} orden(es).`;
  } else if (isAdverse) {
    mensaje = `⚠️ Condición adversa en ${zona} ("${condicion}") pero no requiere pausa ni buffer automático. Revisar manualmente.`;
  } else {
    mensaje = `✅ Clima OK en ${zona} para ${fechaServicio}. Despacho normal.`;
  }

  return {
    zona,
    fechaServicio,
    condicion,
    alertaSevera,
    lluviaActiva,
    pausarAutopilot,
    bufferTbloqueoMinutos: lluviaActiva ? LLUVIA_BUFFER_MINUTOS : 0,
    eventos,
    mensaje,
  };
}

/**
 * Función de conveniencia: evalúa clima + clasifica la excepción para
 * decidir si un servicio individual debe reagendarse o abortarse.
 *
 * Combina weather-exception.ts (reglas de lead time) con la detección de
 * condiciones severas de este módulo.
 *
 * @returns null si no hay condición adversa; WeatherExceptionDecision si la hay.
 */
export function evaluarExcepcionClimaParaServicio(
  forecastResult: GetForecastResult,
  alertLeadTimeHours: number | null,
): WeatherExceptionDecision | null {
  if (forecastResult.isAdverse !== true) return null;
  return classifyWeatherException(alertLeadTimeHours);
}

/**
 * Verificación rápida: ¿hay alguna condición climática que requiera
 * intervención en esta zona?
 *
 * @returns true si el despacho puede proceder normalmente (sin pausa ni buffer).
 */
export function climaPermiteDespachoNormal(
  forecastResult: GetForecastResult,
): boolean {
  if (forecastResult.status !== "ok") return true; // sin datos = no bloqueamos
  if (forecastResult.isAdverse !== true) return true;
  // Si es adverso pero no es severo ni lluvia → permitir con advertencia
  // (el caller debe revisar el mensaje, pero no bloqueamos automáticamente)
  const condicion = forecastResult.condition;
  return !esCondicionSevera(condicion);
}

// ── Helpers de modo operativo ───────────────────────────────────────────────

/**
 * Calcula el modo operativo efectivo para una zona después de aplicar
 * las reglas de clima. Si hay alerta severa, el modo efectivo siempre es
 * "manual" sin importar el flag global.
 *
 * @param autopilotGlobal — valor actual del flag e0_autopilot_mode.
 * @param alertaSeveraEnZona — true si hay alerta severa activa en la zona.
 */
export function modoOperativoEfectivo(
  autopilotGlobal: boolean,
  alertaSeveraEnZona: boolean,
): OperatingMode {
  if (alertaSeveraEnZona) return "manual";
  return resolveOperatingMode(autopilotGlobal);
}
