export const TARIFA_OBJETIVO_HORA = 70; // $CAD/hr — editable por admin

export const GST_RATE = 0.05; // 5%
export const PST_RATE = 0.07; // 7%
export const TOTAL_TAX_RATE = GST_RATE + PST_RATE; // 12%

export const PRICE_FREEZE_MINUTES = 10;

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

// Tabla de precio base completa (derivada: HHE × $70)
export function getBasePriceTable(): Record<ServiceType, number[]> {
  const table: Record<ServiceType, number[]> = {
    regular: [],
    deep: [],
    move_in_out: [],
    post_construction: [],
  };
  (Object.keys(HHE_TABLE) as ServiceType[]).forEach((type) => {
    table[type] = HHE_TABLE[type].map((hhe) => Math.round(hhe * TARIFA_OBJETIVO_HORA));
  });
  return table;
}

export function getHHEForRange(serviceType: ServiceType, squareFeet: number): number {
  const ranges = SQUARE_FEET_RANGES.map((r) => r.max);
  const hheList = HHE_TABLE[serviceType];
  for (let i = 0; i < ranges.length; i++) {
    if (squareFeet <= ranges[i]) return hheList[i];
  }
  return hheList[hheList.length - 1];
}

export function getBasePrice(serviceType: ServiceType, squareFeet: number): number {
  const hhe = getHHEForRange(serviceType, squareFeet);
  return Math.round(hhe * TARIFA_OBJETIVO_HORA);
}

// Multiplicadores de carga orgánica
export function getOrganicMultiplier(
  petsCount: number,
  petsType: string,
  residents: number
): number {
  const hasLongHairPets = petsType.toLowerCase().includes("largo") || petsType.toLowerCase().includes("long");
  const totalPets = petsCount;

  if (totalPets === 0 && residents <= 2) return 0.9;
  if (totalPets <= 1 && !hasLongHairPets && residents >= 2 && residents <= 3) return 1.0;
  if (
    (totalPets >= 1 && totalPets <= 2 && hasLongHairPets) ||
    (residents >= 3 && residents <= 4)
  )
    return 1.15;
  if (totalPets >= 3 || residents >= 5) return 1.3;
  return 1.0; // default
}

// Factor de recencia
export function getRecencyMultiplier(daysSinceCleaning: number): number {
  if (daysSinceCleaning < 30) return 0.85;
  if (daysSinceCleaning <= 60) return 1.0;
  if (daysSinceCleaning <= 90) return 1.15;
  return 1.3;
}

// Zonas de Richmond / Metro Vancouver con recargos
export const ZONES = [
  { name: "Richmond (Steveston)", surcharge: 0 },
  { name: "Richmond (City Centre)", surcharge: 0 },
  { name: "Richmond (East)", surcharge: 0 },
  { name: "Vancouver (West)", surcharge: 25 },
  { name: "Vancouver (East)", surcharge: 20 },
  { name: "Burnaby", surcharge: 20 },
  { name: "North Shore", surcharge: 30 },
  { name: "Surrey", surcharge: 35 },
  { name: "Delta", surcharge: 25 },
  { name: "New Westminster", surcharge: 20 },
] as const;

export type ZoneName = (typeof ZONES)[number]["name"];

export function getZoneSurcharge(zoneName: string): number {
  const zone = ZONES.find((z) => z.name === zoneName);
  return zone?.surcharge ?? 0;
}

// Hold de seguridad (T-72h)
// Hold = MAX(fórmula_base, 40% del total proyectado)
// Fórmula base: (Tarifa_hora × 3h × N_referencia) × 1.10
export function calculateHold(
  serviceType: ServiceType,
  squareFeet: number,
  totalProjected: number
): number {
  const nReference = getNReference(serviceType, squareFeet);
  const formulaBase = Math.round(TARIFA_OBJETIVO_HORA * 3 * nReference * 1.1);
  const fortyPercent = Math.round(totalProjected * 0.4);
  return Math.max(formulaBase, fortyPercent);
}

function getNReference(serviceType: ServiceType, squareFeet: number): number {
  // N de referencia para el Hold según tipo + ft²
  if (serviceType === "regular" && squareFeet <= 1500) return 2;
  if (serviceType === "deep" && squareFeet <= 2500) return 3;
  if (serviceType === "move_in_out" && squareFeet > 2500) return 4;
  if (serviceType === "post_construction") return 4;
  return 3; // default
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
  subtotal: number;
  gst: number;
  pst: number;
  total: number;
  holdAmount: number;
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
  isPreferredDay?: boolean
): PriceBreakdown {
  const basePrice = getBasePrice(serviceType, squareFeet);
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

  const subtotal = basePrice + organicAdjustment + recencyAdjustment + zoneSurcharge + logisticsSurcharge;
  const gst = Math.round(subtotal * GST_RATE * 100) / 100;
  const pst = Math.round(subtotal * PST_RATE * 100) / 100;
  const total = Math.round((subtotal + gst + pst) * 100) / 100;

  const holdAmount = calculateHold(serviceType, squareFeet, total);

  return {
    basePrice,
    organicMultiplier,
    organicAdjustment,
    recencyMultiplier,
    recencyAdjustment,
    zoneSurcharge,
    logisticsSurcharge,
    subtotal,
    gst,
    pst,
    total,
    holdAmount,
  };
}
