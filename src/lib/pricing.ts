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

/**
 * Verifica si una fecha objetivo puede reservarse respetando el corte de las 5 PM
 * del día anterior (hora de Vancouver).
 */
export function canBookDate(targetDate: string): boolean {
  const now = new Date();
  const vancouverParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const y = vancouverParts.find((p) => p.type === "year")?.value;
  const m = vancouverParts.find((p) => p.type === "month")?.value;
  const d = vancouverParts.find((p) => p.type === "day")?.value;
  const hr = vancouverParts.find((p) => p.type === "hour")?.value;
  if (!y || !m || !d || !hr) return false;

  const todayStr = `${y}-${m}-${d}`;
  if (targetDate > todayStr) {
    return Number(hr) < BOOKING_CUTOFF_HOUR;
  }
  return targetDate === todayStr; // hoy siempre permitido si hay capacidad
}

// Cálculo completo de precio
export interface PriceBreakdown {
  basePrice: number;
  organicMultiplier: number;
  organicAdjustment: number;
  recencyMultiplier: number;
  recencyAdjustment: number;
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
  addonZonesCharge: number = 0
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

  const organicAdjustment = Math.round(basePrice * (organicMultiplier - 1));
  const recencyAdjustment = Math.round(basePrice * (recencyMultiplier - 1));

  // v8.3 E4 (D.7): recargo de zonas add-on (ej. Garaje) editables por el
  // admin. El monto SIEMPRE llega ya recalculado por el servidor contra la
  // lista real de zonas activas (calculateAddonZonesCharge) — nunca se
  // confía en un número que venga del cliente.
  const safeAddonZonesCharge = Math.max(0, Math.round(addonZonesCharge));

  const subtotalBeforeRules =
    basePrice + organicAdjustment + recencyAdjustment + zoneSurcharge + logisticsSurcharge + safeAddonZonesCharge;
  const gst = Math.round(subtotalBeforeRules * GST_RATE * 100) / 100;
  const pst = Math.round(subtotalBeforeRules * PST_RATE * 100) / 100;
  const totalBeforeRules = Math.round((subtotalBeforeRules + gst + pst) * 100) / 100;

  const estimatedLaborCost = estimateLaborCost(serviceType, validatedSquareFeet, hheTable);
  const estimatedMarginContribution = calculateMarginContribution(subtotalBeforeRules, estimatedLaborCost);
  const adminReviewRequired = marginIsBelowFloor(subtotalBeforeRules, estimatedLaborCost);

  const holdAmount = calculateHoldWithRate(serviceType, validatedSquareFeet, totalBeforeRules, targetHourlyRate);

  return {
    basePrice,
    organicMultiplier,
    organicAdjustment,
    recencyMultiplier,
    recencyAdjustment,
    zoneSurcharge,
    logisticsSurcharge,
    addonZonesCharge: safeAddonZonesCharge,
    ruleAdjustment: 0,
    appliedRules: [],
    subtotal: subtotalBeforeRules,
    gst,
    pst,
    total: totalBeforeRules,
    holdAmount,
    estimatedLaborCost,
    estimatedMarginContribution,
    adminReviewRequired,
    adminReviewReason: adminReviewRequired
      ? `Margen de contribución estimado ${(estimatedMarginContribution * 100).toFixed(1)}% está por debajo del piso del ${(MARGIN_FLOOR_PERCENT * 100).toFixed(0)}%`
      : undefined,
  };
}
