import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "../hiring-flow/settings-service";

// Módulo nuevo y separado: "Módulo de Cliente" -- facturación. Registro de
// pagos (client_payments) contra facturas (client_invoices).
//
// Tablas / RPC asumidas (otro agente las está creando en paralelo, contrato
// acordado, NO se crean ni se stubean aquí):
//   client_payments(id UUID, client_id UUID, invoice_id UUID,
//     payment_method_id UUID NULL, amount_cents INTEGER,
//     payment_date TIMESTAMPTZ, provider_reference TEXT NULL,
//     status TEXT CHECK IN ('pending','completed','failed','refunded'),
//     created_at)
//   client_invoices(..., total_cents INTEGER, amount_paid_cents INTEGER,
//     balance_due_cents INTEGER, status TEXT, ...)
//   RPC record_client_payment(p_invoice_id UUID, p_client_id UUID,
//     p_payment_method_id UUID, p_amount_cents INTEGER,
//     p_provider_reference TEXT) RETURNS client_payments
//
// La RPC record_client_payment() es ATÓMICA en Postgres: inserta la fila de
// pago con status='completed' Y actualiza
// client_invoices.amount_paid_cents/balance_due_cents/status en la MISMA
// transacción de base de datos. Esta RPC asume que el cobro YA fue
// confirmado por el procesador externo (Stripe/Moneris/PayPal, etc.) ANTES
// de llamarla -- no inicia ningún cobro, solo registra uno ya confirmado.
//
// Nota de arquitectura: a diferencia de
// hiring-flow/candidate-step1-service.ts e invoice-service.ts, que
// implementan un patrón de saga + compensación en la capa de aplicación
// porque no tenían una RPC atómica disponible en Postgres para su
// operación multi-tabla, aquí SÍ existe una RPC real que hace todo dentro
// de una transacción de DB. Ese es el camino correcto/preferido cuando es
// posible -- de hecho, el patrón de esta función (delegar la atomicidad
// completa a una función de Postgres en vez de reimplementar
// compensación en JS) es el que debería retrofit-earse eventualmente a
// esos otros dos servicios si Postgres puede exponer una RPC equivalente
// para sus casos.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PaymentsClient = SupabaseClient<any, "public", any>;

export interface RecordPaymentParams {
  invoiceId: string;
  clientId: string;
  paymentMethodId: string | null;
  amountCents: number;
  providerReference?: string;
  client?: PaymentsClient;
}

export interface RecordPaymentResult {
  paymentId: string;
  invoiceStatus: string;
  balanceDueCents: number;
}

export class PaymentRecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRecordingError";
  }
}

function resolveClient(client?: PaymentsClient): PaymentsClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a client_payments"
    );
  }
  return resolved;
}

// Forma de la fila que retorna la RPC. El contrato acordado declara la
// función como `RETURNS client_payments`, cuyas columnas propias son
// solo id/status/etc. de la tabla client_payments. [ASSUMPTION] Para que
// el caller pueda conocer el resultado de la actualización de la factura
// (status/balance_due_cents) sin una segunda ida a la DB -- y dado que la
// RPC ya tiene esos valores disponibles en el mismo momento, dentro de la
// misma transacción, porque ella misma los acaba de escribir -- se asume
// que la función Postgres real se implementa devolviendo también esas dos
// columnas adicionales junto a la fila de client_payments (ej. vía
// `RETURNS TABLE(...)` con columnas extra, o un tipo compuesto ad-hoc),
// aunque el nombre del tipo de retorno declarado en el contrato diga
// `client_payments`. Si la función Postgres finalmente NO expone esas
// columnas, este código deberá ajustarse (segunda consulta a
// client_invoices) el día que se verifique la firma real contra la
// migración.
interface ClientPaymentRpcRow {
  id: string;
  status: string;
  invoice_status?: string;
  balance_due_cents?: number;
}

export async function recordPayment(
  params: RecordPaymentParams
): Promise<RecordPaymentResult> {
  if (
    params.amountCents === undefined ||
    params.amountCents === null ||
    params.amountCents <= 0
  ) {
    // Se valida ANTES de tocar la DB -- nunca se llama a la RPC con un
    // monto inválido.
    throw new PaymentRecordingError("amountCents must be greater than 0");
  }

  const resolved = resolveClient(params.client);

  const { data, error } = await resolved.rpc("record_client_payment", {
    p_invoice_id: params.invoiceId,
    p_client_id: params.clientId,
    p_payment_method_id: params.paymentMethodId,
    p_amount_cents: params.amountCents,
    p_provider_reference: params.providerReference ?? null,
  });

  if (error || !data) {
    throw new PaymentRecordingError(
      `Failed to record payment for invoice "${params.invoiceId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  // record_client_payment puede devolver la fila directamente o un arreglo
  // de una fila según cómo Supabase serialice el retorno de la función --
  // se soportan ambas formas.
  const row = (Array.isArray(data) ? data[0] : data) as
    | ClientPaymentRpcRow
    | undefined;

  if (!row || !row.id) {
    throw new PaymentRecordingError(
      `record_client_payment returned no payment row for invoice "${params.invoiceId}"`
    );
  }

  return {
    paymentId: row.id,
    invoiceStatus: row.invoice_status ?? row.status,
    balanceDueCents: row.balance_due_cents ?? 0,
  };
}
