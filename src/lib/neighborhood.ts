/**
 * v8.3 E11 (D.11.5) — Reglas de vecindario: ruido por tipo de zona,
 * notificación a concierge (opt-in del cliente), protocolo de acceso por
 * tipo de edificio.
 */

export type ZoneType = "condo_55plus" | "airbnb" | "residential" | "commercial";

export interface NoiseWindow {
  allowed: boolean;
  earliestHour: number; // 24h
  latestHour: number; // 24h
  note: string;
}

/**
 * Ventana de horario permitido para actividades ruidosas (aspiradora,
 * lavadora de presión, etc.) según el tipo de zona.
 */
export function getNoiseWindow(zoneType: ZoneType): NoiseWindow {
  switch (zoneType) {
    case "condo_55plus":
      return { allowed: true, earliestHour: 9, latestHour: 17, note: "Condominio 55+: 9AM-5PM estricto." };
    case "airbnb":
      return { allowed: true, earliestHour: 10, latestHour: 16, note: "Airbnb: coordinar con check-in/check-out del huésped, no solo horario fijo." };
    case "commercial":
      return { allowed: true, earliestHour: 6, latestHour: 20, note: "Zona comercial: ventana amplia." };
    case "residential":
    default:
      return { allowed: true, earliestHour: 8, latestHour: 18, note: "Residencial estándar: 8AM-6PM." };
  }
}

/** ¿Una hora propuesta (24h) cae dentro de la ventana permitida? */
export function isWithinNoiseWindow(zoneType: ZoneType, hour: number): boolean {
  const w = getNoiseWindow(zoneType);
  return hour >= w.earliestHour && hour < w.latestHour;
}

export type ConciergeNotifyPreference = "always" | "only_if_absent" | "never";

/**
 * ¿Hay que notificar al concierge 24h antes? Depende del opt-in del cliente
 * Y de si el cliente estará ausente (cuando la preferencia es "only_if_absent").
 */
export function shouldNotifyConcierge(
  preference: ConciergeNotifyPreference,
  clientWillBeAbsent: boolean
): boolean {
  if (preference === "never") return false;
  if (preference === "always") return true;
  return clientWillBeAbsent; // only_if_absent
}

export type BuildingAccessType = "fob" | "front_desk" | "alarm_code";

export interface AccessProtocol {
  instructions: string;
  neverDo: string;
}

/**
 * Protocolo de acceso por tipo de edificio. Regla dura común a los tres:
 * nunca desactivar cámaras — asumir que todo está siendo grabado.
 */
export function getAccessProtocol(type: BuildingAccessType): AccessProtocol {
  const neverDo = "Nunca desactivar cámaras de seguridad — asumir que todo está siendo grabado.";
  switch (type) {
    case "fob":
      return { instructions: "Usar el fob asignado; devolverlo al finalizar si es prestado.", neverDo };
    case "front_desk":
      return { instructions: "Anunciarse en recepción, mostrar identificación del equipo.", neverDo };
    case "alarm_code":
      return { instructions: "Ingresar el código de alarma provisto en el brief; nunca compartirlo fuera del equipo asignado.", neverDo };
  }
}
