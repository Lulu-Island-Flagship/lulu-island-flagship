/**
 * v8.3 E0.8 — Adaptador de contabilidad (QBO).
 *
 * Re-exporta la interfaz ya honesta de `src/lib/qbo-adapter.ts` (status
 * "not_configured" hasta que exista OAuth2 real con QBO — ver TODO ahí) bajo
 * el mismo nombre estable para que el cron de sync y cualquier código nuevo
 * importen desde un solo punto por proveedor, igual que payments.ts.
 */

export { pushSalesReceipt, type PushSalesReceiptInput, type PushSalesReceiptResult } from "@/lib/qbo-adapter";
