/**
 * v8.3 E2.6 — Interfaz de envío de Sales Receipts a QuickBooks Online.
 *
 * TODO(dueño/infra): no hay integración OAuth2 contratada con QBO todavía
 * (requiere Client ID/Secret + flujo de autorización + refresh token
 * almacenado de forma segura). Antes de usar esto en producción, completar
 * el OAuth2 de QBO y setear las credenciales como variables de entorno
 * (nunca hardcodeadas). Esta función es la interfaz estable que el resto del
 * sistema debe llamar; solo cambia la implementación interna cuando exista
 * la integración real.
 *
 * Mismo patrón que src/lib/sms.ts: mientras no haya proveedor configurado,
 * pushSalesReceipt() nunca intenta una llamada de red — devuelve status
 * "not_configured" de forma determinista para que el caller (cron/qbo-sync)
 * pueda registrar el intento, contar reintentos y aplicar backoff sin fallar
 * silenciosamente ni inventar una integración que no existe.
 */

export interface PushSalesReceiptInput {
  orderId: string;
  grossAmountCents: number;
  gstAmountCents: number;
  pstAmountCents: number;
  description: string;
}

export interface PushSalesReceiptResult {
  status: "not_configured" | "success" | "failed";
  qboTransactionId: string | null;
  providerResponse: string | null;
}

/**
 * Interfaz estable de envío. Implementación real pendiente (ver TODO
 * arriba). Nunca lanza: siempre resuelve con un resultado explícito para que
 * el caller decida sin condicionales especiales por proveedor faltante.
 */
export async function pushSalesReceipt(_input: PushSalesReceiptInput): Promise<PushSalesReceiptResult> {
  // TODO(dueño/infra): reemplazar este bloque por la llamada real a la API
  // de QBO una vez exista el OAuth2. Ejemplo de forma esperada (NO
  // implementado, NO son credenciales reales):
  //
  //   const client = getQboClient();
  //   const response = await client.salesReceipts.create({ ... });
  //   return { status: "success", qboTransactionId: response.Id, providerResponse: JSON.stringify(response) };

  return {
    status: "not_configured",
    qboTransactionId: null,
    providerResponse: null,
  };
}
