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
// Fix (auditoría 2026-07-31, item 17): "zh-CN" es el locale de China
// continental -- región distinta de donde opera el negocio (BC, Canadá).
// Con el ICU de este runtime (verificado con Node) "zh-CN" + currency:"CAD"
// ya renderiza "CA$" y no el símbolo ¥, pero el mapeo de región errado
// sigue siendo un riesgo latente en otros motores/versiones de ICU (algunos
// resuelven símbolo de moneda con reglas específicas de la región del
// locale). "zh-Hans-CA" (chino simplificado, región Canadá) es la etiqueta
// BCP-47 correcta para "clientes que leen chino simplificado en Canadá" y
// produce el mismo resultado verificado (fecha/hora/moneda idénticos en
// pruebas), sin ambigüedad de región.
const CURRENCY_LOCALE_MAP: Record<string, string> = {
  en: "en-CA",
  fr: "fr-CA",
  zh: "zh-Hans-CA",
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
