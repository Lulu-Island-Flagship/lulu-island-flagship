/**
 * Helpers de fecha/zona horaria para America/Vancouver.
 * Centralizado para evitar offsets fijos (-07:00 / -08:00) que fallan al cambiar PDT/PST.
 */

import { toIntlLocale } from "@/lib/format";

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

/**
 * Construye un Date UTC que representa la medianoche local de Vancouver para
 * un string de fecha "YYYY-MM-DD" arbitrario (no solo "hoy"). Análogo a
 * `getVancouverTodayMidnight()` pero para cualquier fecha.
 */
export function parseVancouverDate(dateOnlyStr: string): Date {
  const offset = getVancouverOffset(dateOnlyStr);
  return new Date(`${dateOnlyStr}T00:00:00${offset}`);
}

/**
 * Día de la semana (0 = domingo ... 6 = sábado) para un string de solo-fecha
 * "YYYY-MM-DD" (ej. service_date). El día de la semana de una fecha
 * calendario NO depende de la zona horaria -- "2026-08-02" es domingo sin
 * importar en qué huso corra el proceso -- pero `new Date("YYYY-MM-DDT00:00:00")`
 * seguido de `.getDay()` depende implícitamente de la hora local del
 * runtime para interpretar el string. Esta función construye el Date a
 * partir de los componentes Y/M/D directamente (como `formatServiceDateDisplay`)
 * para eliminar esa dependencia implícita y dejar explícito que el cálculo
 * es agnóstico al huso horario del servidor.
 */
export function getDayOfWeekFromDateString(dateOnlyStr: string): number {
  const [year, month, day] = dateOnlyStr.split("-").map(Number);
  if (!year || !month || !day) return NaN;
  return new Date(year, month - 1, day).getDay();
}

/**
 * Día de la semana actual (0 = domingo ... 6 = sábado) según la fecha local
 * de HOY en Vancouver -- no la fecha/hora del runtime del servidor, que
 * puede correr en UTC u otro huso y dar un día distinto al que realmente es
 * "hoy" en Vancouver (ej. cerca de medianoche).
 */
export function getVancouverDayOfWeek(): number {
  return getDayOfWeekFromDateString(getVancouverTodayString());
}

/**
 * Suma (o resta) días a un string de solo-fecha "YYYY-MM-DD" y devuelve el
 * resultado en el mismo formato. Aritmética de calendario pura vía
 * Date.UTC/getUTCDate -- inmune a la zona horaria del host, a diferencia de
 * `setDate()`/`getDate()` (que usan la hora LOCAL del runtime y pueden
 * desplazar el día calendario resultante si el proceso corre fuera de
 * Vancouver).
 */
export function addDaysToDateString(dateOnlyStr: string, days: number): string {
  const [year, month, day] = dateOnlyStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * Formatea una fecha/instante (Date o string parseable, ej. un timestamp
 * `created_at`/`expires_at` de Postgres) para mostrarlo al usuario en la
 * zona horaria de negocio (America/Vancouver) explícitamente. A diferencia
 * de `formatServiceDateDisplay` (que es para strings de solo-fecha
 * "YYYY-MM-DD" sin componente de hora), esta función SÍ debe convertir de
 * zona horaria porque el valor de entrada es un instante real (timestamptz).
 * Sin `timeZone: "America/Vancouver"` explícito, `toLocaleDateString`/
 * `Intl.DateTimeFormat` usan la zona horaria del entorno de ejecución
 * (navegador del usuario o servidor), lo que puede mostrar un día distinto
 * al que corresponde en Vancouver.
 */
export function formatVancouverDate(
  date: Date | string,
  locale: string = "en",
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" }
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    ...options,
    timeZone: "America/Vancouver",
  }).format(d);
}

/**
 * Formatea un string de solo-fecha "YYYY-MM-DD" (service_date, tal como viene
 * de Postgres) para mostrarlo al usuario, SIN pasar por conversión de zona
 * horaria. `service_date` ya representa el día calendario correcto -- no es
 * un instante UTC -- así que `new Date("YYYY-MM-DD")` (que lo interpreta como
 * medianoche UTC) seguido de `timeZone: "America/Vancouver"` retrocede un día
 * (la medianoche UTC cae en la tarde del día anterior en Vancouver, UTC-7/8).
 * Bug real detectado en ReservationSummary.tsx y confirmacion/page.tsx:
 * ambos mostraban el día anterior al realmente reservado. Este helper
 * construye el Date a partir de los componentes locales directamente, sin
 * ninguna conversión de huso horario, para que el día mostrado sea siempre
 * el que dice el string.
 */
export function formatServiceDateDisplay(
  dateOnlyStr: string,
  locale: string = "en",
  options: Intl.DateTimeFormatOptions = { weekday: "long", year: "numeric", month: "long", day: "numeric" }
): string {
  const [year, month, day] = dateOnlyStr.split("-").map(Number);
  if (!year || !month || !day) return dateOnlyStr;
  const localDate = new Date(year, month - 1, day);
  return localDate.toLocaleDateString(toIntlLocale(locale), options);
}

/**
 * Formatea un string de solo-hora "HH:MM:SS" (service_time, tal como viene
 * de Postgres) para mostrarlo al usuario en formato legible y localizado
 * (ej. "2:00 PM" en inglés, "14 h 00" en francés) en vez de crudo
 * ("14:00:00"). Se construye un Date neutro (2000-01-01) solo para poder usar
 * Intl.DateTimeFormat -- la hora ya es la hora local del servicio tal como
 * se reservó, no requiere ninguna conversión de huso horario.
 */
export function formatServiceTimeDisplay(timeStr: string, locale: string = "en"): string {
  const [hh, mm] = timeStr.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return timeStr;
  const d = new Date(2000, 0, 1, hh, mm);
  return new Intl.DateTimeFormat(toIntlLocale(locale), { hour: "numeric", minute: "2-digit" }).format(d);
}
