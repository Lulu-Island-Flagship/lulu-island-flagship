import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 4.1: Posiciones Públicas.
//
// Tabla asumida (contrato acordado con la migración de Fase 2 que se está
// creando en paralelo, NO se crea ni se stubea aquí):
//   positions(
//     id UUID,
//     slug TEXT UNIQUE,
//     title TEXT,
//     description TEXT,
//     is_public BOOLEAN,
//     created_at TIMESTAMPTZ,
//     updated_at TIMESTAMPTZ,
//     created_by UUID
//   )

type PositionsClient = SupabaseClient<any, "public", any>;

// Regla del plan: "no expongas IDs internos (UUIDs) en URLs/respuestas
// públicas si puedes evitarlo". Por eso PublicPosition deliberadamente NO
// incluye `id`: un candidato/anon solo debería poder referirse a una
// posición por su slug, nunca por su UUID interno.
export interface PublicPosition {
  slug: string;
  title: string;
  description: string | null;
}

interface PositionRow {
  slug: string;
  title: string;
  description: string | null;
  is_public: boolean;
}

// No distinguimos "no existe" de "existe pero no es pública" -- ambos
// casos deben comportarse EXACTAMENTE igual desde afuera (mismo error,
// mismo mensaje genérico), para no filtrar por timing/mensaje si una
// posición no pública existe. El caller nunca debe poder usar esto como
// oráculo de existencia de posiciones privadas.
export class PositionNotFoundError extends Error {
  constructor(slug: string) {
    super(`Position not found: "${slug}"`);
    this.name = "PositionNotFoundError";
  }
}

function resolveClient(client?: PositionsClient): PositionsClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a positions"
    );
  }
  return resolved;
}

export async function getPublicPosition(
  slug: string,
  client?: PositionsClient
): Promise<PublicPosition> {
  const resolved = resolveClient(client);

  // Filtramos is_public=true directamente en la query (no post-filtramos
  // en memoria): así una posición existente-pero-no-pública nunca siquiera
  // llega a este proceso, y el camino de código para "no existe" vs.
  // "existe pero privada" es idéntico (mismo `data === null`).
  const { data, error } = await resolved
    .from("positions")
    .select("slug, title, description, is_public")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load position "${slug}": ${error.message}`);
  }

  const row = data as PositionRow | null;
  if (!row) {
    throw new PositionNotFoundError(slug);
  }

  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
  };
}
