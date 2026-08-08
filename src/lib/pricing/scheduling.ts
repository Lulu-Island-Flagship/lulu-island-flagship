import { getVancouverTodayString, getVancouverTomorrowString } from "../date-utils";
import {
  type ServiceType,
  HHE_TABLE,
  getHHEForRange,
} from "./catalog";

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
