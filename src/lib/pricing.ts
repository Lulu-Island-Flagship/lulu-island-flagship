import { getVancouverTodayString, getVancouverTomorrowString } from "./date-utils";
import { applyPricingRules, type PricingRule, type RuleContext } from "./rules";

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

/**
 * Convierte dólares (NUMERIC 10,2) a centavos enteros (INTEGER).
 * Usa Math.round para evitar errores de punto flotante (ej. 0.1 + 0.2).
 *
 *   dollarsToCents(250.00)  → 25000
 *   dollarsToCents(19.99)   →  1999
 *   dollarsToCents(0)       →     0
 */
export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convierte centavos enteros a dólares (NUMERIC 10,2).
 * La división puede producir decimales; el caller decide el redondeo.
 *
 *   centsToDollars(25000) → 250.00
 *   centsToDollars(1999)  →  19.99
 */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Guarda defensiva: si un valor que DEBERÍA estar en centavos es < 100,
 * es casi seguro que alguien pasó dólares sin convertir. Loggea un warning
 * pero no revienta — el caller decide si lo trata como error fatal o no.
 *
 * Heurística: cualquier servicio de limpieza real cuesta ≥ $1.00 = 100¢.
 * Un valor < 100¢ sugiere fuertemente que se pasaron dólares (ej. 2.50
 * interpretado como 2.50¢ en vez de 250¢).
 *
 * @returns true si el valor parece razonable en centavos (≥ 100 o 0).
 */
export function assertCentsReasonable(cents: number, context?: string): boolean {
  if (cents > 0 && cents < 100) {
    console.warn(
      `[cents-guard] SUSPICIOUS: value ${cents}¢ (< $1.00) in context "${context ?? "unknown"}". ` +
      `This may indicate dollars were passed where cents were expected (missing ×100 conversion).`
    );
    return false;
  }
  return true;
}

export const TARIFA_OBJETIVO_HORA = 70; // $CAD/hr — fallback y referencia; la tarifa real se lee de pricing_settings
export const MINIMUM_WAGE_BC = 18.25; // $CAD/hr vigente 2026-06-01
export const DEFAULT_LABOR_HOURLY = 25.0; // estimación conservadora (incluye carga básica)
export const MARGIN_FLOOR_PERCENT = 0.15; // piso de margen de contribución del 15%

export const GST_RATE = 0.05; // 5%
export const PST_RATE = 0.07; // 7%
export const TOTAL_TAX_RATE = GST_RATE + PST_RATE; // 12%

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCurrentHHETable(supabase: any): Promise<Record<ServiceType, number[]>> {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTargetHourlyRate(supabase: any): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("get_current_target_hourly_rate").single();
    if (error || !data) return TARIFA_OBJETIVO_HORA;
    const rate = data.get_current_target_hourly_rate as number;
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

export function getBasePriceWithRate(
  serviceType: ServiceType,
  squareFeet: number,
  targetHourlyRate: number,
  hheTable: Record<ServiceType, number[]> = HHE_TABLE
): number {
  const hhe = getHHEForRange(serviceType, squareFeet, hheTable);
  return Math.round(hhe * targetHourlyRate);
}

/** Wrapper con fallback $70 para compatibilidad con código cliente/legacy. */
export function getBasePrice(serviceType: ServiceType, squareFeet: number): number {
  return getBasePriceWithRate(serviceType, squareFeet, TARIFA_OBJETIVO_HORA);
}

// Multiplicadores de carga orgánica
// Reglas exactas del spec v8.2:
//   sin mascotas + ≤2 residentes: 0.90×
//   1 mascota pelo corto + 2-3 residentes: 1.00×
//   1-2 mascotas pelo largo + 3-4 residentes: 1.15×
//   3+ mascotas o 5+ residentes: 1.30×
//
// Los casos no cubiertos explícitamente por el spec se redondean al
// multiplicador inmediatamente inferior (conservador para el cliente).
export function getOrganicMultiplier(
  petsCount: number,
  petsType: string,
  residents: number
): number {
  const hasPets = petsCount > 0;
  const hasLongHairPets =
    hasPets &&
    (petsType.toLowerCase().includes("largo") ||
      petsType.toLowerCase().includes("long") ||
      petsType.toLowerCase().includes("multiple"));

  // Caso extremo: 3+ mascotas o 5+ residentes
  if (petsCount >= 3 || residents >= 5) return 1.3;

  // Sin mascotas
  if (!hasPets) {
    return residents <= 2 ? 0.9 : 1.0;
  }

  // Con mascotas de pelo largo
  if (hasLongHairPets) {
    if (residents >= 3 && residents <= 4) return 1.15;
    // 1-2 mascotas pelo largo con 1-2 residentes: no está explícito; usamos 1.00
    return 1.0;
  }

  // Con mascotas de pelo corto
  if (residents >= 2 && residents <= 3) return 1.0;
  // 1 mascota pelo corto + 1 residente o +4 residentes: no explícito; usamos 1.00
  return 1.0;
}

// Factor de recencia (interno — NUNCA visible al cliente)
export function getRecencyMultiplier(daysSinceCleaning: number): number {
  if (daysSinceCleaning < 30) return 0.85;
  if (daysSinceCleaning <= 60) return 1.0;
  if (daysSinceCleaning <= 90) return 1.15;
  return 1.3;
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

/**
 * Suma zone_time_hours × tarifa objetivo de las zonas add-on seleccionadas
 * por el cliente. Ignora selecciones que no existen en `available` (defensa
 * ante manipulación del payload — el servidor SIEMPRE recalcula desde la
 * lista real de zonas add-on activas, nunca confía en un monto enviado por
 * el cliente).
 */
export function calculateAddonZonesCharge(
  available: AddonZoneOption[],
  selectedZones: string[],
  targetHourlyRate: number = TARIFA_OBJETIVO_HORA
): number {
  const selectedSet = new Set(selectedZones);
  const totalHours = available
    .filter((z) => selectedSet.has(z.zone))
    .reduce((sum, z) => sum + z.timeHours, 0);
  return Math.round(totalHours * targetHourlyRate);
}

// Hold de seguridad (T-72h)
// Hold = MAX(fórmula_base, 40% del total proyectado)
// Fórmula base: (Tarifa_hora × 3h × N_referencia) × 1.10
export function calculateHoldWithRate(
  serviceType: ServiceType,
  squareFeet: number,
  totalProjected: number,
  targetHourlyRate: number
): number {
  const nReference = getNReference(serviceType, squareFeet);
  const formulaBase = Math.round(targetHourlyRate * 3 * nReference * 1.1);
  const fortyPercent = Math.round(totalProjected * 0.4);
  return Math.max(formulaBase, fortyPercent);
}

/** Wrapper que acepta tarifa opcional; fallback $70 para código cliente/legacy. */
export function calculateHold(
  serviceType: ServiceType,
  squareFeet: number,
  totalProjected: number,
  targetHourlyRate: number = TARIFA_OBJETIVO_HORA
): number {
  return calculateHoldWithRate(serviceType, squareFeet, totalProjected, targetHourlyRate);
}

export function getNReference(serviceType: ServiceType, squareFeet: number): number {
  // N de referencia para el Hold según tipo + ft²
  if (serviceType === "regular" && squareFeet <= 1500) return 2;
  if (serviceType === "deep" && squareFeet <= 2500) return 3;
  if (serviceType === "move_in_out" && squareFeet > 2500) return 4;
  if (serviceType === "post_construction") return 4;
  return 3; // default
}

export function estimateLaborCost(
  serviceType: ServiceType,
  squareFeet: number,
  hheTable: Record<ServiceType, number[]> = HHE_TABLE
): number {
  const hhe = getHHEForRange(serviceType, squareFeet, hheTable);
  return Math.round(hhe * DEFAULT_LABOR_HOURLY);
}

export function calculateMarginContribution(subtotal: number, laborCost: number): number {
  if (subtotal <= 0) return 0;
  return (subtotal - laborCost) / subtotal;
}

export function marginIsBelowFloor(subtotal: number, laborCost: number): boolean {
  return calculateMarginContribution(subtotal, laborCost) < MARGIN_FLOOR_PERCENT;
}

// ─── E6.6: Factura impresa opcional ────────────────────────────────
// Del plan: "Factura impresa opcional (+$2 correo; B2B siempre impresa+digital)".
// B2B/government ya reciben ambos formatos por defecto sin recargo (ver
// trigger trg_b2b_printed_invoice_default, migración 201) -- el recargo
// solo aplica a B2C que lo solicita explícitamente (cliente en el cotizador
// web, o coordinador en su nombre en una reserva telefónica).
export const PRINTED_INVOICE_SURCHARGE = 2;

export function computePrintedInvoiceCharge(
  printedInvoiceRequested: boolean,
  accountType: "b2c" | "b2b" | "government"
): number {
  if (accountType !== "b2c") return 0; // B2B/Gov: incluido, sin recargo
  return printedInvoiceRequested ? PRINTED_INVOICE_SURCHARGE : 0;
}

// ─── Módulo 3: Capacidad y equipos ─────────────────────────────────

export const DEFAULT_BASE_SCHEDULE_MINUTES = 480; // 8 horas
export const DEFAULT_CONTINGENCY_MINUTES = 120;   // 2 horas
export const SLOT_DURATION_MINUTES = 30;
export const BOOKING_CUTOFF_HOUR = 17; // 5:00 PM día anterior

export const DEFAULT_TRANSIT_MINUTES = 30;
export const DEFAULT_SETUP_MINUTES = 15;
export const DEFAULT_BUFFER_MINUTES = 15;
export const DEFAULT_CLEANUP_MINUTES = 15;

export interface TeamRequirements {
  minTeams: number;
  maxTeams: number;
  blockedTimeMinutes: number;
  transitMinutes: number;
}

/**
 * Determina N_min y N_max según el spec v8.2.
 *
 * | Tipo + ft²              | N_min | N_max B2C | N_max B2B |
 * | Regular ≤1500           | 2     | 3         | 4         |
 * | Deep ≤2500              | 2     | 3         | 5         |
 * | Move-out ≤2500          | 2     | 3         | 5         |
 * | Move-out >2500          | 3     | 3         | 6         |
 * | Post-construcción >3500 | 4     | N/A       | 6         |
 */
function getNRange(
  serviceType: ServiceType,
  squareFeet: number,
  accountType: "b2c" | "b2b" | "government" = "b2c"
): { minTeams: number; maxTeams: number } {
  const isB2b = accountType === "b2b" || accountType === "government";

  if (serviceType === "regular" && squareFeet <= 1500) {
    return { minTeams: 2, maxTeams: isB2b ? 4 : 3 };
  }
  if (serviceType === "deep" && squareFeet <= 2500) {
    return { minTeams: 2, maxTeams: isB2b ? 5 : 3 };
  }
  if (serviceType === "move_in_out" && squareFeet <= 2500) {
    return { minTeams: 2, maxTeams: isB2b ? 5 : 3 };
  }
  if (serviceType === "move_in_out" && squareFeet > 2500) {
    return { minTeams: 3, maxTeams: isB2b ? 6 : 3 };
  }
  if (serviceType === "post_construction" && squareFeet > 3500) {
    return { minTeams: 4, maxTeams: isB2b ? 6 : 0 };
  }
  if (serviceType === "post_construction") {
    return { minTeams: 3, maxTeams: isB2b ? 5 : 3 };
  }

  // Fallback conservador
  return { minTeams: 2, maxTeams: isB2b ? 4 : 3 };
}

/**
 * Calcula N mínimo/máximo de equipos y tiempo bloqueado para un servicio.
 *
 * T_bloqueo = (HHE / N) + T_transito + T_setup + T_buffer + T_cleanup
 *
 * Elige N dentro del rango permitido minimizando el tiempo bloqueado sin
 * exceder T_bloqueo_max del spec.
 */
export function calculateTeamRequirements(
  serviceType: ServiceType,
  squareFeet: number,
  accountType: "b2c" | "b2b" | "government" = "b2c",
  hheTable: Record<ServiceType, number[]> = HHE_TABLE,
  transitMinutes: number = DEFAULT_TRANSIT_MINUTES,
  baseScheduleMinutes: number = DEFAULT_BASE_SCHEDULE_MINUTES,
  contingencyMinutes: number = DEFAULT_CONTINGENCY_MINUTES
): TeamRequirements {
  const hheHours = getHHEForRange(serviceType, squareFeet, hheTable);
  const hheMinutes = Math.round(hheHours * 60);
  const { minTeams, maxTeams } = getNRange(serviceType, squareFeet, accountType);

  // Si post-construction >3500 no es B2B, el spec dice N/A; forzamos revisión admin.
  if (maxTeams === 0) {
    return { minTeams, maxTeams: 0, blockedTimeMinutes: 0, transitMinutes };
  }

  const fixedOverhead = DEFAULT_SETUP_MINUTES + DEFAULT_BUFFER_MINUTES + DEFAULT_CLEANUP_MINUTES;

  // Tabla de T_bloqueo_max por spec
  let blockedTimeMaxMinutes = 8 * 60;
  if (serviceType === "regular" && squareFeet <= 1500) blockedTimeMaxMinutes = 3 * 60;
  else if (serviceType === "deep" && squareFeet <= 2500) blockedTimeMaxMinutes = 4.5 * 60;
  else if (serviceType === "move_in_out" && squareFeet <= 2500) blockedTimeMaxMinutes = 5.5 * 60;
  else if (serviceType === "move_in_out" && squareFeet > 2500) blockedTimeMaxMinutes = 5.5 * 60;
  else if (serviceType === "post_construction" && squareFeet > 3500) blockedTimeMaxMinutes = 6 * 60;

  // Elegir el menor N que mantenga T_bloqueo dentro del máximo, sin bajar de N_min.
  let chosenN = minTeams;
  for (let n = minTeams; n <= maxTeams; n++) {
    const blockTime = Math.ceil(hheMinutes / n) + transitMinutes + fixedOverhead;
    if (blockTime <= blockedTimeMaxMinutes) {
      chosenN = n;
      break;
    }
    chosenN = n;
  }

  const blockedTimeMinutes = Math.min(
    Math.ceil(hheMinutes / chosenN) + transitMinutes + fixedOverhead,
    baseScheduleMinutes + contingencyMinutes
  );

  return { minTeams, maxTeams, blockedTimeMinutes, transitMinutes };
}

/**
 * Devuelve la HHE estimada para una orden dado serviceType y ft².
 */
export function getEstimatedServiceMinutes(
  serviceType: ServiceType,
  squareFeet: number,
  hheTable: Record<ServiceType, number[]> = HHE_TABLE
): number {
  return Math.round(getHHEForRange(serviceType, squareFeet, hheTable) * 60);
}

export interface BookingAvailability {
  allowed: boolean;
  reason?: "too_soon" | "past_cutoff";
}

/**
 * Regla única de disponibilidad de reserva por fecha (corte de las 5 PM
 * hora de Vancouver). Fuente ÚNICA de verdad: tanto el date-picker de la UI
 * (src/components/reserva/DatePicker.tsx) como el endpoint autoritativo de
 * confirmación de pago (src/app/api/stripe/confirm/route.ts) y
 * src/app/api/capacity/route.ts llaman a esta función.
 *
 * Regla vigente (corregida 2026-08-01, auditoría externa -- hallazgo
 * confirmado): el corte de las 5 PM representa "ya no da tiempo de preparar
 * el equipo para MAÑANA", no una prohibición general de reservar. La versión
 * anterior comparaba la hora actual contra BOOKING_CUTOFF_HOUR para
 * CUALQUIER fecha futura, así que después de las 5 PM se rechazaba incluso
 * una reserva para dentro de dos semanas -- un bug de disponibilidad, no una
 * regla de negocio real.
 *  - Hoy NUNCA es reservable (mínimo 1 día de anticipación).
 *  - Mañana (el día calendario inmediatamente siguiente a hoy, hora de
 *    Vancouver) deja de ser reservable si, al momento de la consulta, ya son
 *    las BOOKING_CUTOFF_HOUR (17:00) hora de Vancouver o más tarde.
 *  - Pasado mañana en adelante SIEMPRE es reservable (sujeto a disponibilidad
 *    de cupo), sin importar la hora actual.
 */
export function checkBookingDateAllowed(targetDate: string): BookingAvailability {
  const now = new Date();
  const todayStr = getVancouverTodayString();

  if (targetDate <= todayStr) {
    return { allowed: false, reason: "too_soon" };
  }

  const tomorrowStr = getVancouverTomorrowString();
  if (targetDate === tomorrowStr) {
    const hourPart = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .find((p) => p.type === "hour")?.value;

    if (hourPart !== undefined && Number(hourPart) >= BOOKING_CUTOFF_HOUR) {
      return { allowed: false, reason: "past_cutoff" };
    }
  }

  return { allowed: true };
}

/**
 * Verifica si una fecha objetivo puede reservarse respetando el corte de las 5 PM
 * hora de Vancouver. Wrapper de conveniencia sobre checkBookingDateAllowed()
 * para call sites que solo necesitan un boolean.
 */
export function canBookDate(targetDate: string): boolean {
  return checkBookingDateAllowed(targetDate).allowed;
}

// Cálculo completo de precio
export interface PriceBreakdown {
  basePrice: number;
  organicMultiplier: number;
  organicAdjustment: number;
  recencyMultiplier: number;
  recencyAdjustment: number;
  densityMultiplier: number;
  densityAdjustment: number;
  zoneSurcharge: number;
  logisticsSurcharge: number;
  addonZonesCharge: number;
  ruleAdjustment: number;
  appliedRules: import("./rules").AppliedRule[];
  subtotal: number;
  gst: number;
  pst: number;
  total: number;
  holdAmount: number;
  estimatedLaborCost: number;
  estimatedMarginContribution: number;
  adminReviewRequired: boolean;
  adminReviewReason?: string;
  /** Fix (auditoría externa, hallazgo #1): propagado desde el motor de reglas
   *  real (src/lib/rules.ts applyPricingRules) -- antes calculatePrice nunca
   *  lo invocaba y estos campos quedaban hardcodeados. */
  blocked: boolean;
  blockReason?: string;
  flagged: boolean;
  flagReason?: string;
}

/**
 * Fix (auditoría externa, hallazgo #2): antes el subtotal se manejaba en
 * dólares enteros (Math.round sin decimales) mientras GST/PST se redondeaban
 * por separado a centavos, y algunos call sites volvían a Math.round() el
 * subtotal después de sumarle el ajuste de reglas (perdiendo los centavos que
 * una regla `price_add`/`price_multiplier` pudiera introducir). Eso podía
 * producir subtotal + gst + pst !== total. Este helper hace TODA la
 * aritmética interna en centavos enteros (sin floats fraccionarios) y solo
 * convierte a dólares al final, para el único propósito de mostrar/persistir
 * el valor -- así el cuadre subtotal+gst+pst=total queda garantizado por
 * construcción.
 */
export function computeTaxBreakdown(subtotalDollars: number): {
  subtotal: number;
  gst: number;
  pst: number;
  total: number;
} {
  const subtotalCents = Math.round(Math.max(0, subtotalDollars) * 100);
  const gstCents = Math.round(subtotalCents * GST_RATE);
  const pstCents = Math.round(subtotalCents * PST_RATE);
  const totalCents = subtotalCents + gstCents + pstCents;

  return {
    subtotal: subtotalCents / 100,
    gst: gstCents / 100,
    pst: pstCents / 100,
    total: totalCents / 100,
  };
}

function deriveDefaultOrganicLoad(
  petsCount: number,
  petsType: string,
  residents: number
): RuleContext["organicLoad"] {
  if (petsCount >= 3 || residents >= 5) return "high";
  const hasLongHair =
    petsType.toLowerCase().includes("long") ||
    petsType.toLowerCase().includes("largo") ||
    petsType.toLowerCase().includes("multiple");
  if (hasLongHair || residents >= 3) return "medium";
  return "low";
}

export function calculatePrice(
  serviceType: ServiceType,
  squareFeet: number,
  petsCount: number,
  petsType: string,
  residents: number,
  daysSinceCleaning: number,
  zoneName: string,
  dayOfWeek?: number, // 0=Dom, 6=Sab
  isPreferredDay?: boolean,
  targetHourlyRate: number = TARIFA_OBJETIVO_HORA,
  hheTable: Record<ServiceType, number[]> = HHE_TABLE,
  addonZonesCharge: number = 0,
  // Fix (auditoría externa, hallazgo #1 -- CRÍTICO): el motor de reglas
  // headless (src/lib/rules.ts) existía pero calculatePrice nunca lo
  // invocaba, así que `ruleAdjustment`/`appliedRules` salían siempre
  // hardcodeados a 0/[]. Ambos parámetros son opcionales (default: sin
  // reglas activas ni contexto extra) para no romper llamadas existentes que
  // todavía no pasen reglas -- pero ahora, si se pasan, el motor real se
  // aplica y su resultado es el que efectivamente afecta subtotal/total.
  rules: PricingRule[] = [],
  ruleContextExtra: Partial<RuleContext> = {}
): PriceBreakdown {
  // Validar squareFeet para evitar precios absurdos
  const MAX_SQUARE_FEET = 10000;
  const validatedSquareFeet = Math.min(Math.max(300, squareFeet), MAX_SQUARE_FEET);

  const basePrice = getBasePriceWithRate(serviceType, validatedSquareFeet, targetHourlyRate, hheTable);
  const organicMultiplier = getOrganicMultiplier(petsCount, petsType, residents);
  const recencyMultiplier = getRecencyMultiplier(daysSinceCleaning);
  const zoneSurcharge = getZoneSurcharge(zoneName);

  // Recargo logístico por día no preferencial (ej. fin de semana)
  let logisticsSurcharge = 0;
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    logisticsSurcharge = 25;
  }
  if (isPreferredDay === false) {
    logisticsSurcharge = 25;
  }

  const densityMultiplier = getDensityMultiplier(validatedSquareFeet, organicMultiplier, recencyMultiplier);
  const organicAdjustment = Math.round(basePrice * (organicMultiplier - 1));
  const recencyAdjustment = Math.round(basePrice * (recencyMultiplier - 1));
  const densityAdjustment = Math.round(basePrice * (densityMultiplier - 1));

  // v8.3 E4 (D.7): recargo de zonas add-on (ej. Garaje) editables por el
  // admin. El monto SIEMPRE llega ya recalculado por el servidor contra la
  // lista real de zonas activas (calculateAddonZonesCharge) — nunca se
  // confía en un número que venga del cliente.
  const safeAddonZonesCharge = Math.max(0, Math.round(addonZonesCharge));

  const subtotalBeforeRules =
    basePrice + organicAdjustment + recencyAdjustment + densityAdjustment + zoneSurcharge + logisticsSurcharge + safeAddonZonesCharge;

  const estimatedLaborCost = estimateLaborCost(serviceType, validatedSquareFeet, hheTable);
  const estimatedMarginContribution = calculateMarginContribution(subtotalBeforeRules, estimatedLaborCost);
  const marginAdminReviewRequired = marginIsBelowFloor(subtotalBeforeRules, estimatedLaborCost);

  // Construir el RuleContext con los datos disponibles en esta función. Los
  // campos que calculatePrice no conoce (score de cliente, tipo de cuenta,
  // demanda de zona, antelación de reserva, etc.) los provee el caller vía
  // ruleContextExtra -- si no los provee, se usan defaults conservadores
  // (equivalentes a "sin reglas activas" para condiciones que dependan de
  // ellos, ya que un contexto por defecto no debería disparar reglas
  // agresivas segmentadas).
  const ruleContext: RuleContext = {
    zone: zoneName,
    dayOfWeek: dayOfWeek ?? 1,
    isPreferredDay: isPreferredDay ?? true,
    serviceType,
    serviceSubtype: ruleContextExtra.serviceSubtype ?? "",
    squareFeet: validatedSquareFeet,
    clientScore: ruleContextExtra.clientScore ?? 50,
    servicesCount: ruleContextExtra.servicesCount ?? 0,
    disputesLostCount: ruleContextExtra.disputesLostCount ?? 0,
    accountType: ruleContextExtra.accountType ?? "b2c",
    clientType: ruleContextExtra.clientType ?? "new",
    zoneDemand: ruleContextExtra.zoneDemand ?? 50,
    organicLoad: ruleContextExtra.organicLoad ?? deriveDefaultOrganicLoad(petsCount, petsType, residents),
    daysSinceCleaning,
    advanceNoticeDays: ruleContextExtra.advanceNoticeDays ?? 0,
  };

  const ruleResult = applyPricingRules(rules, ruleContext, basePrice, subtotalBeforeRules);

  // Fix (auditoría externa, hallazgo #2): toda la aritmética de
  // subtotal/GST/PST/total se hace en centavos enteros dentro de
  // computeTaxBreakdown, incluyendo el ajuste real de reglas -- ya no se
  // pierde precisión redondeando el subtotal a dólares enteros antes de
  // sumarle el ajuste.
  const taxBreakdown = computeTaxBreakdown(subtotalBeforeRules + ruleResult.adjustment);

  const holdAmount = calculateHoldWithRate(serviceType, validatedSquareFeet, taxBreakdown.total, targetHourlyRate);

  const adminReviewRequired = marginAdminReviewRequired || ruleResult.flagged;
  const adminReviewReasons: string[] = [];
  if (marginAdminReviewRequired) {
    adminReviewReasons.push(
      `Margen de contribución estimado ${(estimatedMarginContribution * 100).toFixed(1)}% está por debajo del piso del ${(MARGIN_FLOOR_PERCENT * 100).toFixed(0)}%`
    );
  }
  if (ruleResult.flagged && ruleResult.flagReason) {
    adminReviewReasons.push(ruleResult.flagReason);
  }

  return {
    basePrice,
    organicMultiplier,
    organicAdjustment,
    recencyMultiplier,
    recencyAdjustment,
    densityMultiplier,
    densityAdjustment,
    zoneSurcharge,
    logisticsSurcharge,
    addonZonesCharge: safeAddonZonesCharge,
    ruleAdjustment: ruleResult.adjustment,
    appliedRules: ruleResult.appliedRules,
    subtotal: taxBreakdown.subtotal,
    gst: taxBreakdown.gst,
    pst: taxBreakdown.pst,
    total: taxBreakdown.total,
    holdAmount,
    estimatedLaborCost,
    estimatedMarginContribution,
    adminReviewRequired,
    adminReviewReason: adminReviewReasons.length > 0 ? adminReviewReasons.join("; ") : undefined,
    blocked: ruleResult.blocked,
    blockReason: ruleResult.blockReason,
    flagged: ruleResult.flagged,
    flagReason: ruleResult.flagReason,
  };
}
