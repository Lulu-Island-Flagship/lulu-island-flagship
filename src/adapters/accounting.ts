/**
 * v8.3 E0.8 — Adaptador de contabilidad (QBO).
 *
 * Re-exporta la interfaz ya honesta de `src/lib/qbo-adapter.ts` (status
 * "not_configured" hasta que exista OAuth2 real con QBO — ver TODO ahí) bajo
 * el mismo nombre estable para que el cron de sync y cualquier código nuevo
 * importen desde un solo punto por proveedor, igual que payments.ts.
 */

export { pushSalesReceipt, type PushSalesReceiptInput, type PushSalesReceiptResult } from "@/lib/qbo-adapter";

import {
  pushSalesReceipt,
  type PushSalesReceiptInput,
  type PushSalesReceiptResult,
} from "@/lib/qbo-adapter";

/**
 * v8.3 E0 (auditoría 2026-07-18) — interfaz abstracta mínima + mock. Ver
 * mismo patrón en esignature.ts/maps.ts/communications.ts de este directorio.
 */
export interface AccountingAdapter {
  pushSalesReceipt(input: PushSalesReceiptInput): Promise<PushSalesReceiptResult>;
}

export const accountingAdapter: AccountingAdapter = { pushSalesReceipt };

export function createMockAccountingAdapter(
  overrides?: Partial<AccountingAdapter>
): AccountingAdapter {
  return {
    pushSalesReceipt: async (_input: PushSalesReceiptInput) => ({
      status: "not_configured",
      qboTransactionId: null,
      providerResponse: null,
    }),
    ...overrides,
  };
}
