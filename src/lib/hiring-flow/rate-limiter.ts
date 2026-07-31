import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 3: Autenticación y Seguridad Base.
//
// ---------------------------------------------------------------------------
// Limitación honesta: esto NO es un rate limiter distribuido
// ---------------------------------------------------------------------------
//
// Este stack despliega en Vercel serverless, sin Redis/Upstash disponible
// (mismo motivo documentado en settings-service.ts). Un Map en memoria de
// proceso solo cuenta requests que caen en la MISMA instancia serverless.
// Con múltiples instancias/regiones concurrentes, cada una tiene su propio
// contador independiente, así que el límite real efectivo puede terminar
// siendo (límite configurado × número de instancias activas) en vez del
// límite exacto. Esto es un rate limiter "best-effort por instancia", NO
// una garantía dura de "máximo N intentos en total".
//
// Si en el futuro esto necesita ser un rate limiter real y distribuido, lo
// que hace falta es Redis/Upstash con INCR + EXPIRE atómico por key (o un
// script Lua con sliding window), para que el contador sea compartido y
// consistente entre todas las instancias. Ese cambio reemplazaría
// únicamente la sección de estado (el Map de abajo); la interfaz pública
// (checkRateLimit) no tendría que cambiar.
//
// A pesar de esta limitación, sigue siendo útil como primera línea de
// defensa barata contra abuso obvio (loops de fuerza bruta desde una sola
// instancia caliente), y es mejor que no tener nada mientras no se migra a
// Redis.

type RateLimiterClient = SupabaseClient<any, "public", any>;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitState = new Map<string, RateLimitEntry>();

// Ventana fija de 1 minuto. No es configurable vía settings porque el plan
// solo pide configurar el LÍMITE (cuántos intentos), no el tamaño de
// ventana; hardcodear la ventana acá es una decisión de implementación del
// algoritmo, no una regla de negocio como "cuántos intentos por código".
const WINDOW_MS = 60_000;

// Solo para tests: permite resetear el estado in-memory entre casos.
export function resetRateLimiterState(): void {
  rateLimitState.clear();
}

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

// Regla dura del plan: si no se puede leer el límite configurado (Redis no
// aplica acá, pero el equivalente es "no se pudo leer el setting" -- ej.
// SettingNotFoundError por typo en la key, o la DB de settings caída), el
// rate limiter debe FALLAR ABIERTO: permitir el tráfico, pero loggear una
// alerta clara. Es preferible dejar pasar tráfico sin limitar a bloquear
// todo el sistema por un problema de configuración/infra ajeno al request
// del candidato. El conteo in-memory en sí (el Map) no puede fallar -- es
// una estructura de datos local sin I/O -- así que el fail-open aplica
// específicamente a la lectura del límite vía getSetting().
export async function checkRateLimit(
  key: string,
  settingKey: string,
  client?: RateLimiterClient
): Promise<{ allowed: boolean; remaining: number }> {
  let limit: number;
  try {
    const raw = await getSetting(settingKey, client);
    limit = Number(raw);
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error(
        `Invalid rate limit setting "${settingKey}": expected a positive number, got "${raw}"`
      );
    }
  } catch (err) {
    // Fail-open: no se pudo determinar el límite configurado. Loggear una
    // alerta explícita (esto debería disparar monitoreo/alertas en prod)
    // y permitir el tráfico sin limitar en vez de bloquear todo el flujo.
    console.error(
      `[rate-limiter] FAIL-OPEN: could not read rate limit setting "${settingKey}" for key "${key}". ` +
        `Allowing request unlimited. Underlying error:`,
      err
    );
    return { allowed: true, remaining: -1 };
  }

  const now = Date.now();
  const entry = rateLimitState.get(key);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    // Nueva ventana (primera vez visto, o la ventana anterior expiró).
    rateLimitState.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count };
}
