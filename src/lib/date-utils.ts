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
 * Día calendario de Vancouver ("YYYY-MM-DD") correspondiente a un instante
 * (un `timestamptz` de Postgres, un Date, o un ISO string).
 *
 * Por qué existe: el atajo `String(row.created_at).slice(0, 10)` devuelve el
 * día en UTC, no en Vancouver. Un movimiento de las 18:00 del 31 de agosto en
 * Vancouver es el 1 de septiembre en UTC, así que ese atajo lo fecha en el mes
 * equivocado -- y en un export contable eso descuadra el cierre de mes.
 */
export function toVancouverDateString(instant: Date | string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Convierte un rango de días calendario de Vancouver ("YYYY-MM-DD") en el par
 * de instantes UTC que hay que usar para filtrar una columna `timestamptz`
 * (`created_at`, `paid_at`, etc.) en Postgres.
 *
 * Por qué existe: filtrar un `timestamptz` con un string sin offset
 * (`.gte("created_at", "2026-08-14T00:00:00")` o
 * `.lte("created_at", "2026-08-14T23:59:59")`) NO consulta el día de
 * Vancouver -- Postgres interpreta el string sin offset en la zona horaria de
 * la sesión, que en Supabase es UTC. El resultado es una ventana corrida 7 u 8
 * horas: en verano (UTC-7) todo lo ocurrido entre las 17:00 y la medianoche
 * hora de Vancouver cae en el día UTC SIGUIENTE y queda fuera del rango. Ese
 * tramo es justamente el final de la jornada laboral, así que el error no es
 * uniforme: se come sistemáticamente el cierre del día.
 *
 * Devuelve un intervalo semiabierto [startUtc, endUtcExclusive) -- se usa con
 * `.gte(startUtc)` y `.lt(endUtcExclusive)`. Semiabierto en vez de
 * `.lte("...T23:59:59")` porque ese patrón además pierde la última fracción de
 * segundo del día (cualquier fila entre 23:59:59.001 y 23:59:59.999).
 *
 * @param startDateStr Primer día del rango, inclusive ("YYYY-MM-DD" en Vancouver).
 * @param endDateStr   Último día del rango, INCLUSIVE. Si se omite, el rango
 *                     cubre únicamente `startDateStr` (un solo día).
 */
export function vancouverDayRangeUtc(
  startDateStr: string,
  endDateStr: string = startDateStr
): { startUtc: string; endUtcExclusive: string } {
  return {
    startUtc: parseVancouverDate(startDateStr).toISOString(),
    // El día siguiente al último día incluido: así el rango semiabierto
    // cubre el último día completo, hasta el último milisegundo.
    endUtcExclusive: parseVancouverDate(addDaysToDateString(endDateStr, 1)).toISOString(),
  };
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
