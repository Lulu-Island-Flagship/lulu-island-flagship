import type { SupabaseClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════════════════════
// UNIT CONVENTION — MONEY TYPE (migración 339, RAÍZ-3)
// ───────────────────────────────────────────────────────────────────────────
// QUOTES  (quotes.total, quotes.subtotal, quotes.gst, quotes.pst)
//   → DÓLARES con centavos (Postgres NUMERIC(10,2)).
//     calculatePrice() / computeTaxBreakdown() devuelven dólares.
//
// ORDERS  (orders.total_paid_cents, orders.hold_amount_cents,
//          orders.hold_authorized_amount_cents, orders.wallet_amount_collected_cents)
//   → CENTAVOS enteros (Postgres INTEGER / BIGINT).
//     Migración 229 unificó orders a centavos.
//
// INVOICES (client_invoices.total_cents, client_invoices.tax_cents)
//   → CENTAVOS enteros (Postgres INTEGER).
//
// REGLA DE ORO: cuando un valor cruza de quotes → orders/invoices,
// SIEMPRE multiplicar × 100 con dollarsToCents() o Math.round(x * 100).
// NUNCA asumir que un valor en dólares ya está en centavos.
// ═══════════════════════════════════════════════════════════════════════════

export const TARIFA_OBJETIVO_HORA = 70; // $CAD/hr — fallback y referencia; la tarifa real se lee de pricing_settings
export const MINIMUM_WAGE_BC = 18.25; // $CAD/hr vigente 2026-06-01
export const DEFAULT_LABOR_HOURLY = 25.0; // estimación conservadora (incluye carga básica)
export const MARGIN_FLOOR_PERCENT = 0.15; // piso de margen de contribución del 15%

export const PRICE_FREEZE_MINUTES = 10;
export const CONSENT_VERSIONS = {
  tc: "v1.0",
  pipa: "v1.0",
  marketing: "v1.0",
  photoMarketing: "v1.0",
};

// Tipos de mascota permitidos en el cotizador
export const PET_TYPES = ["none", "short_hair", "long_hair", "multiple"] as const;
export type PetType = (typeof PET_TYPES)[number];

// Categorías de servicio para el selector inicial
export const SERVICE_CATEGORIES = [
  { key: "home", label: "Home", labelEs: "Hogar", description: "Residential cleaning services" },
  { key: "commercial", label: "Commercial", labelEs: "Comercial", description: "Office, Airbnb, and construction cleanup" },
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]["key"];

// Subtipos de servicio — mapean internamente a los tipos de HHE
export const SERVICE_SUBTYPES = {
  home: [
    { key: "first_time", label: "First Time Cleaning", labelEs: "Primera Limpieza", mapsTo: "deep" as ServiceType },
    { key: "regular", label: "Regular Cleaning", labelEs: "Limpieza Regular", mapsTo: "regular" as ServiceType },
    { key: "move_in_out", label: "Move In/Out", labelEs: "Mudanza Entrada/Salida", mapsTo: "move_in_out" as ServiceType },
  ],
  commercial: [
    { key: "office", label: "Office Cleaning", labelEs: "Oficina", mapsTo: "regular" as ServiceType },
    { key: "airbnb", label: "Airbnb / Short-term Rental", labelEs: "Airbnb / Renta Corta", mapsTo: "regular" as ServiceType },
    { key: "post_construction", label: "Post-Construction", labelEs: "Post-Construcción", mapsTo: "post_construction" as ServiceType },
  ],
} as const;

// Tipos internos para HHE (no visibles al cliente)
export const SERVICE_TYPES = [
  { key: "regular", label: "Regular Cleaning", labelEs: "Limpieza Regular" },
  { key: "deep", label: "Deep Cleaning", labelEs: "Limpieza Profunda" },
  { key: "move_in_out", label: "Move-in / Move-out", labelEs: "Mudanza Entrada/Salida" },
  { key: "post_construction", label: "Post-Construction", labelEs: "Post-Construcción" },
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number]["key"];

export const SQUARE_FEET_RANGES = [
  { max: 700, label: "≤ 700 ft²" },
  { max: 1500, label: "700 – 1,500 ft²" },
  { max: 2500, label: "1,500 – 2,500 ft²" },
  { max: 3500, label: "2,500 – 3,500 ft²" },
  { max: Infinity, label: "> 3,500 ft²" },
] as const;

// Tabla HHE (Horas-Hombre Estimadas) — 4 tipos × 5 rangos = 20 celdas
// Precio = HHE × TARIFA_OBJETIVO_HORA
export const HHE_TABLE: Record<ServiceType, number[]> = {
  regular: [1.5, 2.5, 4.0, 6.0, 8.0],
  deep: [2.5, 4.0, 6.5, 9.0, 12.0],
  move_in_out: [3.0, 5.0, 8.0, 11.0, 15.0],
  post_construction: [4.0, 6.5, 10.0, 14.0, 18.0],
};

/**
 * Lee la tabla HHE vigente desde Supabase.
 * Fallback: HHE_TABLE hardcodeada si no hay conexión o no hay filas.
 */
export async function getCurrentHHETable(supabase: SupabaseClient): Promise<Record<ServiceType, number[]>> {
  try {
    const { data, error } = await supabase.rpc("get_current_hhe_table");
    if (error || !Array.isArray(data) || data.length === 0) return HHE_TABLE;

    const table: Record<ServiceType, number[]> = {
      regular: [...HHE_TABLE.regular],
      deep: [...HHE_TABLE.deep],
      move_in_out: [...HHE_TABLE.move_in_out],
      post_construction: [...HHE_TABLE.post_construction],
    };

    for (const row of data) {
      const st = row.service_type as ServiceType;
      const idx = Number(row.range_index);
      const val = Number(row.hhe_value);
      if (table[st] && Number.isInteger(idx) && idx >= 0 && idx <= 4 && !Number.isNaN(val) && val > 0) {
        table[st][idx] = val;
      }
    }
    return table;
  } catch {
    return HHE_TABLE;
  }
}

export function getHHEForRange(
  serviceType: ServiceType,
  squareFeet: number,
  hheTable: Record<ServiceType, number[]> = HHE_TABLE
): number {
  const ranges = SQUARE_FEET_RANGES.map((r) => r.max);
  const hheList = hheTable[serviceType];
  for (let i = 0; i < ranges.length; i++) {
    if (squareFeet <= ranges[i]) return hheList[i];
  }
  return hheList[hheList.length - 1];
}

/**
 * Lee la tarifa objetivo vigente desde Supabase.
 * Fallback: TARIFA_OBJETIVO_HORA (70) si no hay conexión o no hay fila.
 */
export async function getTargetHourlyRate(supabase: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("get_current_target_hourly_rate").single();
    if (error || !data) return TARIFA_OBJETIVO_HORA;
    const rate = (data as { get_current_target_hourly_rate: number }).get_current_target_hourly_rate;
    return typeof rate === "number" && rate > 0 ? rate : TARIFA_OBJETIVO_HORA;
  } catch {
    return TARIFA_OBJETIVO_HORA;
  }
}

// Tabla de precio base completa (derivada: HHE × tarifa objetivo)
export function getBasePriceTable(targetHourlyRate: number = TARIFA_OBJETIVO_HORA): Record<ServiceType, number[]> {
  const table: Record<ServiceType, number[]> = {
    regular: [],
    deep: [],
    move_in_out: [],
    post_construction: [],
  };
  (Object.keys(HHE_TABLE) as ServiceType[]).forEach((type) => {
    table[type] = HHE_TABLE[type].map((hhe) => Math.round(hhe * targetHourlyRate));
  });
  return table;
}

// Zonas activas de servicio — exactamente 5, una sola vez cada una
export const ZONES = [
  { name: "Richmond", surcharge: 0, isActive: true },
  { name: "Vancouver", surcharge: 20, isActive: true },
  { name: "North Vancouver", surcharge: 30, isActive: true },
  { name: "West Vancouver", surcharge: 30, isActive: true },
  { name: "UBC", surcharge: 25, isActive: true },
] as const;

// Solo zonas activas para el selector
export const ACTIVE_ZONES = ZONES.filter((z) => z.isActive);

export type ZoneName = (typeof ZONES)[number]["name"];

export function getZoneSurcharge(zoneName: string): number {
  const zone = ZONES.find((z) => z.name === zoneName);
  return zone?.surcharge ?? 0;
}

// ─── E4 (D.7): zonas add-on editables por el admin, propagadas a cotización ──
// "agregar zona = nombre + peso + tiempo estimado, y aparece automáticamente
// en cotización, reparto y checklist". Solo zonas que el admin marca
// explícitamente is_addon_zone=true (ej. Garaje) llegan aquí — las zonas del
// catálogo base (cocina, baño, sala, habitación...) ya están en D.1/D.2.
export interface AddonZoneOption {
  zone: string;
  zoneLabel: string;
  timeHours: number;
}
