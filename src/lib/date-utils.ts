/**
 * Helpers de fecha/zona horaria para America/Vancouver.
 * Centralizado para evitar offsets fijos (-07:00 / -08:00) que fallan al cambiar PDT/PST.
 */

/**
 * Devuelve el offset ISO de Vancouver para una fecha local dada (e.g. "-07:00" o "-08:00").
 */
export function getVancouverOffset(localDateStr: string): string {
  const probe = new Date(`${localDateStr}T12:00:00`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(probe);

  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-7";
  const match = tzPart.match(/GMT([+-]\d{1,2})/);
  if (!match) return "-07:00";
  const hours = parseInt(match[1], 10);
  const sign = hours < 0 ? "-" : "+";
  return `${sign}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

/**
 * Fecha local de hoy en Vancouver como string "YYYY-MM-DD".
 */
export function getVancouverTodayString(): string {
  return new Date().toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).split(",")[0];
}

/**
 * Fecha local de mañana en Vancouver como string "YYYY-MM-DD".
 */
export function getVancouverTomorrowString(): string {
  const todayStr = getVancouverTodayString();
  const offset = getVancouverOffset(todayStr);
  const today = new Date(`${todayStr}T12:00:00${offset}`);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split("T")[0];
}

/**
 * Construye un Date UTC a partir de fecha y hora locales de Vancouver.
 */
export function parseVancouverDateTime(localDate: string, localTime: string): Date {
  const offset = getVancouverOffset(localDate);
  return new Date(`${localDate}T${localTime}:00${offset}`);
}

/**
 * Medianoche local de hoy en Vancouver como Date UTC.
 */
export function getVancouverTodayMidnight(): Date {
  const vancouverDateStr = getVancouverTodayString();
  const offset = getVancouverOffset(vancouverDateStr);
  return new Date(`${vancouverDateStr}T00:00:00${offset}`);
}
