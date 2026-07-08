/**
 * v8.3 E0-C4 — Helper único de feature flags.
 * Contrato (criterio de aceptación E0): un flag apagado oculta su funcionalidad
 * SIN romper el resto del sistema. Por eso este helper es fail-closed:
 * flag inexistente, soft-deleted o error de DB => false (apagado), nunca throw.
 */

type FlagRow = { activo: boolean | null } | null;

export interface FlagClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        is(col: string, val: null): {
          maybeSingle(): Promise<{ data: FlagRow; error: { message: string } | null }>;
        };
      };
    };
  };
}

/**
 * Devuelve true SOLO si el flag existe, no está soft-deleted y activo === true.
 * Cualquier otro caso (incluido error de red/DB) => false. Nunca lanza excepción.
 */
export async function isFlagEnabled(
  client: FlagClient,
  nombre: string
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("feature_flags")
      .select("activo")
      .eq("nombre", nombre)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return false;
    return data.activo === true;
  } catch {
    return false;
  }
}
