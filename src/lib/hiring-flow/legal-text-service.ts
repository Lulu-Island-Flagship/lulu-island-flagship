import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). No tiene integración con el resto del sistema todavía.
//
// Tabla asumida (ver supabase/migrations/253_hiring_flow_legal_texts.sql):
//   legal_texts(
//     id UUID PRIMARY KEY,
//     key TEXT,
//     version TEXT,
//     content TEXT,
//     is_active BOOLEAN,
//     effective_from TIMESTAMPTZ,
//     effective_until TIMESTAMPTZ,
//     created_at TIMESTAMPTZ,
//     created_by UUID
//   )
//   UNIQUE(key, version); a lo sumo 1 fila activa por key (índice único
//   parcial WHERE is_active).

type LegalTextsClient = SupabaseClient<any, "public", any>;

interface LegalTextRow {
  id: string;
  version: string;
  content: string;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export type LegalTextNotFoundReason = "no_such_key" | "no_active_version";

// Distingue explícitamente dos causas MUY distintas de "no encontrado":
//   - "no_such_key": la key nunca existió en legal_texts (probable typo o
//     texto legal que nunca se creó).
//   - "no_active_version": la key existe (tiene al menos una versión
//     histórica) pero ninguna fila está marcada is_active=true ahora mismo
//     (probable operación administrativa incompleta: se desactivó la
//     versión anterior sin activar una nueva).
// Ambos casos son "no hay texto legal que mostrar", pero la causa raíz y
// la acción correctiva son diferentes, por eso se exponen por separado en
// `reason` además del mensaje.
export class LegalTextNotFoundError extends Error {
  readonly key: string;
  readonly reason: LegalTextNotFoundReason;

  constructor(key: string, reason: LegalTextNotFoundReason) {
    const message =
      reason === "no_such_key"
        ? `Legal text not found: no version of "${key}" exists in legal_texts`
        : `Legal text not found: "${key}" exists but has no active version (is_active=true)`;
    super(message);
    this.name = "LegalTextNotFoundError";
    this.key = key;
    this.reason = reason;
  }
}

// Nunca se debe devolver/guardar un texto legal a medio renderizar (con
// placeholders literales tipo "[COMPANY_NAME]" visibles para el
// candidato) -- por eso esto es un throw duro, no un warning silencioso.
export class UnrenderedPlaceholderError extends Error {
  readonly textKey: string;
  readonly placeholders: string[];

  constructor(textKey: string, placeholders: string[]) {
    const list = placeholders.join(", ");
    super(
      `Legal text "${textKey}" has unresolved placeholder(s) after rendering: ${list}`
    );
    this.name = "UnrenderedPlaceholderError";
    this.textKey = textKey;
    this.placeholders = placeholders;
  }
}

// ---------------------------------------------------------------------------
// extractPlaceholders — pura, testeable sin DB
// ---------------------------------------------------------------------------

// Placeholder = [ALGO_EN_MAYUSCULAS_CON_GUIONES_BAJOS], ej. [COMPANY_NAME].
// Debe empezar con una letra A-Z (no dígito/guión bajo) para no matchear
// cosas como "[1]" o cortar en falso dentro de otro texto entre corchetes.
const PLACEHOLDER_PATTERN = /\[([A-Z][A-Z0-9_]*)\]/g;

export function extractPlaceholders(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(PLACEHOLDER_PATTERN)) {
    found.add(match[1]);
  }
  return Array.from(found);
}

// ---------------------------------------------------------------------------
// renderTemplate — pieza central, pura, testeable sin DB
// ---------------------------------------------------------------------------

// `textKey` es opcional y solo se usa para enriquecer el mensaje de error
// si el caller lo tiene disponible (renderLegalText sí lo tiene; un test
// directo de renderTemplate no necesita pasarlo). No cambia la lógica de
// reemplazo, solo el mensaje del throw.
export function renderTemplate(
  content: string,
  variables: Record<string, string>,
  textKey = "(template)"
): string {
  const rendered = content.replace(PLACEHOLDER_PATTERN, (fullMatch, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return variables[name];
    }
    // Variable no provista para este placeholder: se deja intacto para
    // que la verificación de placeholders sin resolver de abajo lo
    // detecte y lance un error claro (nunca se sirve a medias).
    return fullMatch;
  });

  const remaining = extractPlaceholders(rendered);
  if (remaining.length > 0) {
    throw new UnrenderedPlaceholderError(textKey, remaining);
  }

  return rendered;
}

// ---------------------------------------------------------------------------
// renderLegalText
// ---------------------------------------------------------------------------

async function fetchLegalTextRows(
  client: LegalTextsClient,
  key: string
): Promise<LegalTextRow[]> {
  const { data, error } = await client
    .from("legal_texts")
    .select("id, version, content, is_active")
    .eq("key", key);

  if (error) {
    throw new Error(`Failed to load legal text "${key}": ${error.message}`);
  }
  return (data ?? []) as LegalTextRow[];
}

export async function renderLegalText(
  key: string,
  variables: Record<string, string> = {},
  client?: LegalTextsClient
): Promise<{ text: string; version: string; textId: string }> {
  const rows = await fetchLegalTextRows(client as LegalTextsClient, key);

  if (rows.length === 0) {
    throw new LegalTextNotFoundError(key, "no_such_key");
  }

  const active = rows.find((row) => row.is_active);
  if (!active) {
    throw new LegalTextNotFoundError(key, "no_active_version");
  }

  const companyName = String(await getSetting("company_name", client as any));
  const finalVariables: Record<string, string> = {
    COMPANY_NAME: companyName,
    ...variables,
  };

  // Si renderTemplate lanza UnrenderedPlaceholderError, se propaga tal
  // cual (no se atrapa/envuelve aquí) -- el caller nunca debe recibir un
  // texto legal a medio renderizar.
  const text = renderTemplate(active.content, finalVariables, key);

  return { text, version: active.version, textId: active.id };
}
