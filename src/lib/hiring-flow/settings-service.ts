import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). No tiene integración con el resto del sistema todavía.
//
// Tabla asumida (contrato acordado con la migración que se está creando en
// paralelo):
//   system_settings(
//     key TEXT PRIMARY KEY,
//     value TEXT,
//     value_type TEXT CHECK (value_type IN ('string','number','boolean','json')),
//     description TEXT,
//     is_public BOOLEAN,
//     updated_at TIMESTAMPTZ,
//     updated_by UUID
//   )

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsAdmin = SupabaseClient<any, "public", any>;

export type SettingValueType = "string" | "number" | "boolean" | "json";

export interface SystemSettingRow {
  key: string;
  value: string | null;
  value_type: SettingValueType;
  description: string | null;
  is_public: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export class SettingNotFoundError extends Error {
  constructor(key: string) {
    super(`Setting not found: "${key}"`);
    this.name = "SettingNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
//
// El plan original asumía Redis/Upstash para cachear settings entre
// invocaciones. Este repo NO tiene Redis ni Upstash (ver package.json) y
// despliega en Vercel serverless, donde cada invocación puede correr en una
// instancia/región distinta y no hay estado compartido garantizado entre
// ellas.
//
// Por eso usamos un Map en memoria de proceso (module-level) como cache
// best-effort *por instancia* serverless, con TTL simple. Esto es seguro
// porque:
//   - "Cache miss -> lee de DB" es exactamente lo que un Map in-memory hace
//     de forma natural cuando la instancia es nueva (cold start) o cuando
//     el TTL expiró: no hay entrada, se cae a la consulta a Supabase. No
//     hace falta simular "si Redis cae" porque no hay Redis que pueda
//     caerse; el peor caso es simplemente más lecturas a DB.
//   - Nunca hay riesgo de servir un valor cacheado obsoleto por mucho
//     tiempo entre instancias, porque cada instancia tiene su propio TTL
//     independiente y corto (default 60s).
//   - La interfaz pública del servicio (getSetting, getSettingOrDefault,
//     getAllPublicSettings, invalidateSettingsCache) es idéntica a la que
//     tendría una versión respaldada por Redis. Si el proyecto migra a
//     Redis/Upstash más adelante, esta sección (cacheGet/cacheSet/cacheDel)
//     es la única capa a reemplazar; nada del resto del módulo cambiaría.

const DEFAULT_TTL_MS = 60_000;

interface CacheEntry {
  value: string | number | boolean | unknown;
  expiresAt: number;
}

const settingsCache = new Map<string, CacheEntry>();

function cacheGet(key: string): { hit: boolean; value?: unknown } {
  const entry = settingsCache.get(key);
  if (!entry) return { hit: false };
  if (Date.now() > entry.expiresAt) {
    settingsCache.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

function cacheSet(key: string, value: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
  settingsCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateSettingsCache(key?: string): void {
  if (key === undefined) {
    settingsCache.clear();
    return;
  }
  settingsCache.delete(key);
}

// ---------------------------------------------------------------------------
// castValue — pura, testeable sin DB
// ---------------------------------------------------------------------------

export function castValue(
  value: string,
  valueType: SettingValueType
): string | number | boolean | unknown {
  switch (valueType) {
    case "string":
      return value;
    case "number": {
      // Bug real encontrado por npm test (2026-07-31): Number("") es 0, no
      // NaN -- un valor vacío/solo-espacios pasaba el chequeo de
      // Number.isNaN y se devolvía silenciosamente como 0 en vez de fallar
      // ruidosamente. Se rechaza explícito el string vacío ANTES de
      // convertir, para no depender de esa rareza de Number().
      if (value.trim() === "") {
        throw new Error(
          `Corrupt setting value: cannot cast empty string to number (value_type=number)`
        );
      }
      const n = Number(value);
      if (Number.isNaN(n)) {
        throw new Error(
          `Corrupt setting value: cannot cast "${value}" to number (value_type=number)`
        );
      }
      return n;
    }
    case "boolean": {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
      throw new Error(
        `Corrupt setting value: cannot cast "${value}" to boolean (value_type=boolean, expected "true" or "false")`
      );
    }
    case "json": {
      try {
        return JSON.parse(value);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Corrupt setting value: cannot parse "${value}" as JSON (value_type=json): ${reason}`
        );
      }
    }
    default: {
      // Exhaustiveness guard: valueType desconocido en runtime (dato
      // corrupto en DB, ya que el CHECK constraint debería impedirlo).
      throw new Error(`Unknown value_type: "${valueType as string}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

// Replica EXACTAMENTE el patrón de getServiceRoleClient() en src/lib/admin.ts:
// misma env var, mismo manejo de ausencia -> null.
export function getHiringFlowServiceClient(): SettingsAdmin | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

function resolveClient(client?: SettingsAdmin): SettingsAdmin {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a system_settings"
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Fetch + cast helpers
// ---------------------------------------------------------------------------

async function fetchSettingRow(
  client: SettingsAdmin,
  key: string
): Promise<Pick<SystemSettingRow, "value" | "value_type"> | null> {
  const { data, error } = await client
    .from("system_settings")
    .select("value, value_type")
    .eq("key", key)
    .single();

  if (error || !data) {
    return null;
  }
  return data as Pick<SystemSettingRow, "value" | "value_type">;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// SIN default. Key inexistente -> SettingNotFoundError (nunca undefined
// silencioso). Usa getSettingOrDefault() si quieres un fallback explícito.
export async function getSetting(
  key: string,
  client?: SettingsAdmin
): Promise<string | number | boolean | unknown> {
  const cached = cacheGet(key);
  if (cached.hit) {
    return cached.value;
  }

  const resolved = resolveClient(client);
  const row = await fetchSettingRow(resolved, key);
  if (!row) {
    throw new SettingNotFoundError(key);
  }

  const casted = castValue(row.value ?? "", row.value_type);
  cacheSet(key, casted);
  return casted;
}

// Método explícito y separado (nunca un parámetro opcional `default` en
// getSetting), para que un typo en la key nunca devuelva silenciosamente
// un default sin que el llamador lo haya pedido explícitamente.
export async function getSettingOrDefault<T>(
  key: string,
  defaultValue: T,
  client?: SettingsAdmin
): Promise<T | string | number | boolean | unknown> {
  try {
    return await getSetting(key, client);
  } catch (err) {
    if (err instanceof SettingNotFoundError) {
      return defaultValue;
    }
    throw err;
  }
}

export async function getAllPublicSettings(
  client?: SettingsAdmin
): Promise<Record<string, string | number | boolean | unknown>> {
  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("system_settings")
    .select("key, value, value_type")
    .eq("is_public", true);

  if (error) {
    throw new Error(`Failed to load public settings: ${error.message}`);
  }

  const result: Record<string, string | number | boolean | unknown> = {};
  for (const row of (data ?? []) as Array<Pick<SystemSettingRow, "key" | "value" | "value_type">>) {
    const casted = castValue(row.value ?? "", row.value_type);
    result[row.key] = casted;
    cacheSet(row.key, casted);
  }
  return result;
}
