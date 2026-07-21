/**
 * v8.3 E7 fix de auditoría — se evaluó si `computePolicyStatus`/
 * `missingPolicyTypes` debían bloquear alguna operación real (a diferencia
 * del seguro vehicular, que sí bloquea la asignación vía trigger SQL, ver
 * comentario más abajo). Conclusión: NO hay un punto de aplicación
 * operativo seguro para bloquear aquí -- una póliza del negocio vencida no
 * impide despachar un servicio ni cobrar un pago, es una condición legal
 * del NEGOCIO como entidad, no de una transacción puntual. El único punto
 * de aplicación real que exige el spec (B.4 regla #25: "Nunca publicar
 * asegurados/bonded en el sitio hasta que las pólizas reales estén
 * contratadas") es el claim público "insured/bonded" -- y ahí SÍ había un
 * bug real: src/app/[locale]/page.tsx afirmaba "insured" de forma
 * incondicional en el JSON-LD, sin leer nunca allThreePoliciesReady. Ese es
 * el fix aplicado (ver comentario en ese archivo). Forzar un bloqueo
 * operativo aquí (ej. impedir crear órdenes) sería arbitrario: el spec
 * nunca lo pide y rompería el negocio sin que el dueño lo haya pedido.
 *
 * v8.3 E7 (D.9 punto 9) — estado de una póliza de seguro del negocio.
 * Misma lógica de "alerta 30 días / bloqueada si vencida" que ya existe
 * para vehículos, pero aquí como función pura (el bloqueo de vehículos vive
 * en un trigger SQL porque bloquea una asignación; una póliza del negocio no
 * bloquea ninguna operación automáticamente, solo alerta al dueño).
 */

export type PolicyStatus = "active" | "expiring_soon" | "expired";

export const POLICY_EXPIRY_WARNING_DAYS = 30;

export const REQUIRED_POLICY_TYPES = ["vehicular", "general_liability", "errors_omissions"] as const;
export type PolicyType = (typeof REQUIRED_POLICY_TYPES)[number];

export const REQUIRED_COVERAGE_CENTS: Record<PolicyType, number> = {
  vehicular: 200_000_000, // $2M
  general_liability: 500_000_000, // $5M
  errors_omissions: 100_000_000, // $1M
};

export interface PolicyStatusInput {
  expiryDate: string; // ISO date
  today?: Date;
}

/**
 * Convierte una fecha a "días desde epoch" usando SOLO sus componentes
 * calendario (año/mes/día), nunca la hora/timezone -- evita el bug clásico
 * de `new Date(isoString)` (parsea como UTC medianoche) combinado con
 * getters locales (`getFullYear`/`getDate`, que leen en timezone local): en
 * un servidor con offset negativo (p.ej. America/Vancouver) eso corre la
 * fecha un día hacia atrás.
 */
function daysSinceEpoch(input: string | Date): number {
  if (typeof input === "string") {
    const [year, month, day] = input.split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / (1000 * 60 * 60 * 24));
  }
  return Math.floor(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()) / (1000 * 60 * 60 * 24));
}

export function computePolicyStatus(input: PolicyStatusInput): PolicyStatus {
  const todayDays = daysSinceEpoch(input.today ?? new Date());
  const expiryDays = daysSinceEpoch(input.expiryDate);
  const diffDays = expiryDays - todayDays;

  if (diffDays < 0) return "expired";
  if (diffDays <= POLICY_EXPIRY_WARNING_DAYS) return "expiring_soon";
  return "active";
}

export interface CoverageGapCheckInput {
  policyType: PolicyType;
  coverageAmountCents: number;
}

/** ¿La cobertura registrada cumple el mínimo del spec para ese tipo de póliza? */
export function meetsRequiredCoverage(input: CoverageGapCheckInput): boolean {
  return input.coverageAmountCents >= REQUIRED_COVERAGE_CENTS[input.policyType];
}

/**
 * Resumen de los 3 tipos requeridos: cuáles faltan por completo (nunca se
 * registraron) -- necesario para el claim público "asegurados/bonded"
 * (B.4), que exige las 3 pólizas reales contratadas, no solo alguna.
 */
export function missingPolicyTypes(registeredTypes: string[]): PolicyType[] {
  const registered = new Set(registeredTypes);
  return REQUIRED_POLICY_TYPES.filter((t) => !registered.has(t));
}

/**
 * v8.3 P0-4 fix (auditoría Fable5): función pura que decide si el claim
 * público "asegurados/bonded/insured" puede mostrarse (B.4, B.2.25). Reusa
 * la misma regla que ya calculaba GET /api/admin/business-insurance
 * (allThreePoliciesReady), extraída aquí para no duplicarla entre esa ruta
 * admin y el endpoint público de solo-lectura que consume la copia visible
 * del sitio (src/app/api/public/insured-status/route.ts).
 */
export function computeAllThreePoliciesReady(
  policies: { policy_type: string; status: PolicyStatus; meetsRequiredCoverage: boolean }[]
): boolean {
  const missing = missingPolicyTypes(policies.map((p) => p.policy_type));
  return missing.length === 0 && policies.every((p) => p.status !== "expired" && p.meetsRequiredCoverage);
}

/**
 * v8.3 P0-4 fix — check server-side, fail-closed, para el claim público
 * "insured". Cualquier error, credencial faltante, o pólizas incompletas =>
 * false (nunca se afirma "insured" sin certeza total). Usa el service role
 * porque corre sin sesión de usuario (mismo patrón que los crons, ver
 * src/app/api/cron/wellbeing-chemical-reassign/route.ts) -- pero a
 * diferencia de esos crons, esta función NUNCA expone los datos crudos de
 * las pólizas, solo el booleano derivado.
 */
export async function isPublicInsuredClaimReady(): Promise<boolean> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) return false;

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: policies, error } = await supabase
      .from("business_insurance_policies")
      .select("policy_type, coverage_amount_cents, expiry_date")
      .eq("is_active", true)
      .is("deleted_at", null);

    if (error || !policies || policies.length === 0) return false;

    const enriched = policies.map((p: { policy_type: string; coverage_amount_cents: number; expiry_date: string }) => ({
      policy_type: p.policy_type,
      status: computePolicyStatus({ expiryDate: p.expiry_date }),
      meetsRequiredCoverage: meetsRequiredCoverage({
        policyType: p.policy_type as PolicyType,
        coverageAmountCents: p.coverage_amount_cents,
      }),
    }));

    return computeAllThreePoliciesReady(enriched);
  } catch {
    return false;
  }
}
