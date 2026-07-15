/**
 * v8.3 E0.8 — Adaptadores (anti-corruption layer): un punto de importación
 * estable por proveedor externo. Código nuevo debe importar de aquí, nunca
 * directo del SDK del proveedor.
 *
 * Cobertura actual:
 *   - payments.ts        → Stripe + PayPal
 *   - accounting.ts      → QuickBooks Online
 *   - communications.ts  → Twilio/SMS + SendGrid/Email
 *   - maps.ts            → Google Maps (geocodificación)
 *   - esignature.ts      → Documenso/DocuSign (nuevo, era un hueco real)
 *   - weather (ver @/lib/weather-provider — Environment Canada, ya seguía
 *     este mismo patrón desde antes; no se duplica aquí)
 *
 * Rutas EXISTENTES que ya importan `@/lib/stripe`, `@/lib/paypal`, etc.
 * directamente NO se tocaron -- son código de dinero real ya probado.
 * Migrarlas a importar desde `@/adapters/*` es trabajo incremental futuro,
 * no un requisito de este pase.
 */

export * as payments from "./payments";
export * as accounting from "./accounting";
export * as communications from "./communications";
export * as maps from "./maps";
export * as esignature from "./esignature";
