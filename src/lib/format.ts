/**
 * Helpers de formato localizado (moneda, etc.) para la superficie de cliente.
 * Fix (auditoría UX 2026-07-25): varios componentes formateaban moneda con
 * `Intl.NumberFormat("en-CA", ...)` fijo, sin importar el locale (en/fr/zh)
 * que el cliente estaba viendo -- un cliente navegando en francés o chino
 * veía separadores de miles/decimales en formato inglés-canadiense. Se
 * centraliza aquí para que todo el flujo cliente (cotizador, reserva,
 * confirmación) use el mismo formateo localizado.
 */

// Mapea el locale de la app (prefijo de ruta "en" | "fr" | "zh") al locale
// BCP-47 más apropiado para Intl.NumberFormat. La moneda siempre es CAD
// (el negocio opera únicamente en BC, Canadá) independientemente del idioma
// de la interfaz.
const CURRENCY_LOCALE_MAP: Record<string, string> = {
  en: "en-CA",
  fr: "fr-CA",
  zh: "zh-CN",
};

/**
 * Traduce el locale de la app ("en" | "fr" | "zh") al locale BCP-47 más
 * apropiado para Intl.NumberFormat / Intl.DateTimeFormat. Exportado para que
 * date-utils.ts (formatServiceDateDisplay/formatServiceTimeDisplay) use el
 * mismo mapeo en vez de duplicarlo.
 */
export function toIntlLocale(locale: string): string {
  return CURRENCY_LOCALE_MAP[locale] || "en-CA";
}

/**
 * Formatea un monto en dólares CAD usando el locale del cliente.
 * `locale` es el locale de la app ("en" | "fr" | "zh"), no un locale BCP-47
 * completo -- se traduce internamente al locale BCP-47 más apropiado.
 */
export function formatCurrency(amount: number, locale: string): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: "currency",
    currency: "CAD",
  }).format(amount);
}
