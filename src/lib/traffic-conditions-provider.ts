/**
 * v8.3 E8.4 — "Clima y tráfico 6:00 AM (OpenWeatherMap + Google Traffic):
 * retraso >15 min → SMS automático al cliente con nueva ETA; cierre de vía →
 * ruta alternativa antes de salir."
 *
 * v8.3 M-4 (auditoría implacable 2026-07-20b): implementación real de la
 * mitad de CLIMA vía OpenWeatherMap (fetch nativo, sin SDK -- mismo patrón
 * que src/lib/sms.ts / src/lib/email.ts). Requiere `OPENWEATHERMAP_API_KEY`
 * (ver .env.example); sin ella, sigue devolviendo "not_configured" de forma
 * determinista, igual que antes.
 *
 * La mitad de TRÁFICO/RETRASO (Google Distance Matrix/Routes con modelo de
 * tráfico) se deja HONESTAMENTE sin implementar en este pase: no hay
 * credencial `GOOGLE_MAPS_API_KEY` contratada ni un mapeo zona->
 * origen/destino de ruta definido por el dueño del producto (¿desde dónde
 * sale el equipo? ¿cuál es el punto de referencia por zona?) -- inventar esa
 * ruta sería fabricar un dato que el spec pide real ("nunca se inventan
 * datos"). Cuando exista la credencial y el mapeo de rutas por zona, este es
 * el único archivo a tocar: reemplazar el bloque marcado abajo por la
 * llamada real y devolver estimatedDelayMinutes/roadClosureReported no-null.
 */

export interface GetMorningConditionsInput {
  /** Zona/área de servicio a evaluar (Richmond, BC y alrededores). */
  zone: string;
  /** Fecha del día a evaluar (YYYY-MM-DD). */
  date: string;
}

export interface GetMorningConditionsResult {
  status: "not_configured" | "ok" | "error";
  /** Minutos de retraso estimado vs. tiempo de tránsito normal — null si status != 'ok' o si no hay proveedor de tráfico configurado. */
  estimatedDelayMinutes: number | null;
  /** true si hay cierre de vía reportado en la zona — null si status != 'ok' o si no hay proveedor de tráfico configurado. */
  roadClosureReported: boolean | null;
  condition: string | null;
  providerResponse: string | null;
}

export const DELAY_SMS_THRESHOLD_MINUTES = 15;

/** ¿Hay un proveedor real de clima (OpenWeatherMap) configurado? Chequeo puro, nunca hace una llamada de red. */
export function isWeatherProviderConfigured(): boolean {
  return Boolean(process.env.OPENWEATHERMAP_API_KEY);
}

interface OpenWeatherMapCurrentResponse {
  weather?: { main: string; description: string }[];
  wind?: { speed: number };
  name?: string;
  cod?: number | string;
  message?: string;
}

/**
 * Llama a la API "Current Weather Data" de OpenWeatherMap (fetch nativo, sin
 * SDK) para la zona dada. La zona se pasa como nombre de ciudad/localidad
 * (`q=<zone>,BC,CA`) -- este proyecto no tiene todavía una tabla de
 * lat/lng por zona (ver src/lib/geocode.ts, que geocodifica direcciones de
 * clientes puntuales, no zonas de servicio agregadas), así que se usa la
 * búsqueda por nombre que la propia API de OpenWeatherMap soporta.
 */
async function fetchOpenWeatherMapCurrent(zone: string): Promise<
  | { ok: true; condition: string; providerResponse: string }
  | { ok: false; error: string }
> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY as string;
  const query = encodeURIComponent(`${zone},BC,CA`);
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${query}&units=metric&appid=${apiKey}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as OpenWeatherMapCurrentResponse;

    if (!res.ok) {
      return { ok: false, error: data?.message || `OpenWeatherMap HTTP ${res.status}` };
    }

    const description = data.weather?.[0]?.description ?? "unknown";
    return {
      ok: true,
      condition: description,
      providerResponse: JSON.stringify({ weather: data.weather, wind: data.wind, name: data.name }),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown OpenWeatherMap error" };
  }
}

/**
 * Interfaz estable de consulta de clima/tráfico matutino. Nunca lanza:
 * siempre resuelve con un resultado explícito.
 *
 * Estado real (M-4): la mitad de CLIMA es una llamada real a OpenWeatherMap
 * cuando `OPENWEATHERMAP_API_KEY` está configurada. La mitad de TRÁFICO/
 * RETRASO sigue `not_configured` a propósito (ver comentario de cabecera) --
 * por eso, aun con clima real disponible, `estimatedDelayMinutes` y
 * `roadClosureReported` se mantienen `null` (nunca se fabrica un retraso sin
 * un proveedor de tráfico real detrás), y `shouldNotifyClientOfDelay` nunca
 * dispara el SMS automático hasta que exista ese proveedor.
 */
export async function getMorningConditions(input: GetMorningConditionsInput): Promise<GetMorningConditionsResult> {
  if (!isWeatherProviderConfigured()) {
    return {
      status: "not_configured",
      estimatedDelayMinutes: null,
      roadClosureReported: null,
      condition: null,
      providerResponse: null,
    };
  }

  const weather = await fetchOpenWeatherMapCurrent(input.zone);

  if (!weather.ok) {
    console.error(`[traffic-conditions-provider] OpenWeatherMap error for zone ${input.zone}:`, weather.error);
    return {
      status: "error",
      estimatedDelayMinutes: null,
      roadClosureReported: null,
      condition: null,
      providerResponse: null,
    };
  }

  return {
    status: "ok",
    // TODO(dueño/infra): reemplazar por un valor real de
    // googleTrafficClient.delayEstimate(input.zone) cuando exista
    // GOOGLE_MAPS_API_KEY + mapeo de rutas por zona. Hasta entonces, null.
    estimatedDelayMinutes: null,
    roadClosureReported: null,
    condition: weather.condition,
    providerResponse: weather.providerResponse,
  };
}

/** ¿El retraso estimado amerita el SMS automático al cliente con nueva ETA? */
export function shouldNotifyClientOfDelay(estimatedDelayMinutes: number | null): boolean {
  return estimatedDelayMinutes !== null && estimatedDelayMinutes > DELAY_SMS_THRESHOLD_MINUTES;
}
