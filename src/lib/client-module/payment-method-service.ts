import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "../hiring-flow/settings-service";

// Módulo nuevo y separado: "Módulo de Cliente" -- facturación. Gestión de
// métodos de pago (client_payment_methods).
//
// Tabla asumida (otro agente la está creando en paralelo, contrato
// acordado, NO se crea ni se stubea aquí):
//   client_payment_methods(id UUID, client_id UUID,
//     method_type TEXT CHECK IN ('credit_card','pad','etransfer','cheque',
//     'invoice'), provider TEXT NULL, provider_token TEXT NULL,
//     last_four TEXT NULL, expiry_month SMALLINT NULL,
//     expiry_year SMALLINT NULL, is_default BOOLEAN,
//     status TEXT CHECK IN ('active','expired','removed'), created_at,
//     updated_at)
//
// LÍNEA ROJA DE SEGURIDAD (PCI-DSS SAQ-A): este archivo JAMÁS debe aceptar,
// recibir, procesar, loguear ni tener un parámetro para número de tarjeta
// completo (PAN) ni CVV/CVC, bajo ninguna circunstancia -- ni siquiera "para
// pasarlo directo al procesador". Cualquier dato de tarjeta ya debe llegar
// TOKENIZADO desde el frontend/SDK del procesador (Stripe Elements, etc.)
// ANTES de tocar este código; este servicio solo persiste el token
// (providerToken) y metadatos seguros no sensibles (últimos 4 dígitos,
// mes/año de expiración). Si en el futuro sientes la tentación de agregar
// un campo como `cardNumber`, `cvv`, `cvc` o similar -- NO lo hagas.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PaymentMethodsClient = SupabaseClient<any, "public", any>;

export type PaymentMethodType =
  | "credit_card"
  | "pad"
  | "etransfer"
  | "cheque"
  | "invoice";

// Sin campos de PAN/CVV -- ver línea roja de seguridad arriba.
export interface AddPaymentMethodInput {
  clientId: string;
  methodType: PaymentMethodType;
  provider?: string;
  providerToken?: string;
  lastFour?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault?: boolean;
}

export class PaymentMethodValidationError extends Error {
  readonly validationErrors: string[];

  constructor(validationErrors: string[]) {
    super(`Payment method validation failed: ${validationErrors.join("; ")}`);
    this.name = "PaymentMethodValidationError";
    this.validationErrors = validationErrors;
  }
}

const VALID_METHOD_TYPES: PaymentMethodType[] = [
  "credit_card",
  "pad",
  "etransfer",
  "cheque",
  "invoice",
];

const LAST_FOUR_PATTERN = /^\d{4}$/;

// Pura, acumula TODOS los errores (no fail-fast) -- mismo patrón que
// client-service.ts / property-service.ts.
export function validateAddPaymentMethodInput(
  input: AddPaymentMethodInput
): string[] {
  const errors: string[] = [];

  if (!input.methodType || !VALID_METHOD_TYPES.includes(input.methodType)) {
    errors.push(
      `methodType must be one of: ${VALID_METHOD_TYPES.join(", ")}`
    );
  }

  if (!input.clientId || input.clientId.trim().length === 0) {
    errors.push("clientId is required");
  }

  // Refleja el CHECK de la DB (columnas provider/provider_token son NULL-able
  // en general pero el flujo de negocio exige token para métodos que se
  // cobran electrónicamente sin intervención manual). Validado también en la
  // app -- no solo confiado al constraint de Postgres -- para dar un mensaje
  // de error claro al usuario ANTES de tocar la DB.
  if (
    (input.methodType === "credit_card" || input.methodType === "pad") &&
    (!input.providerToken || input.providerToken.trim().length === 0)
  ) {
    errors.push(
      `providerToken is required when methodType is "${input.methodType}"`
    );
  }

  if (input.lastFour !== undefined && !LAST_FOUR_PATTERN.test(input.lastFour)) {
    errors.push("lastFour must be exactly 4 digits");
  }

  if (
    input.expiryMonth !== undefined &&
    (input.expiryMonth < 1 || input.expiryMonth > 12)
  ) {
    errors.push("expiryMonth must be between 1 and 12");
  }

  return errors;
}

function resolveClient(client?: PaymentMethodsClient): PaymentMethodsClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a client_payment_methods"
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// addPaymentMethod
// ---------------------------------------------------------------------------
//
// DECISIÓN sobre "un solo default por cliente": la DB tiene un índice único
// parcial (ej. UNIQUE(client_id) WHERE is_default AND status = 'active') que
// garantiza a nivel de constraint que nunca hay dos métodos default activos
// para el mismo cliente. Aun así, este servicio NO se apoya únicamente en
// que el caller haga un UPDATE de desmarcado por separado antes de llamar
// aquí -- eso sería confiar en que cada caller (actual y futuro) recuerde
// hacerlo, y un olvido rompería el índice único con un error de constraint
// poco claro para el usuario final.
//
// Fix (auditoría 2026-07-31, hallazgo #13): la versión anterior de esta
// función desmarcaba el default previo y luego insertaba el nuevo como DOS
// operaciones HTTP independientes (sin transacción real entre ambas) --
// una caída justo entre las dos podía dejar al cliente TEMPORALMENTE sin
// ningún default activo. Ahora ambos pasos ocurren dentro de una sola
// función RPC SECURITY DEFINER (`add_client_payment_method_atomic`,
// migración 289), en una única transacción de Postgres real -- mismo
// patrón que `create_client_invoice_with_line_items` (281). El índice
// único parcial en la DB (275) sigue como red de seguridad adicional
// (defensa en profundidad), no como el único mecanismo.
export async function addPaymentMethod(
  input: AddPaymentMethodInput,
  client?: PaymentMethodsClient
): Promise<{ paymentMethodId: string }> {
  const validationErrors = validateAddPaymentMethodInput(input);
  if (validationErrors.length > 0) {
    throw new PaymentMethodValidationError(validationErrors);
  }

  const resolved = resolveClient(client);

  const { data, error } = await resolved.rpc("add_client_payment_method_atomic", {
    p_client_id: input.clientId,
    p_method_type: input.methodType,
    p_provider: input.provider ?? null,
    p_provider_token: input.providerToken ?? null,
    p_last_four: input.lastFour ?? null,
    p_expiry_month: input.expiryMonth ?? null,
    p_expiry_year: input.expiryYear ?? null,
    p_is_default: input.isDefault ?? false,
  });

  if (error || !data) {
    throw new Error(
      `Failed to insert client_payment_method for client "${input.clientId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as { id: string } | undefined;
  if (!row || !row.id) {
    throw new Error(
      `add_client_payment_method_atomic returned no data for client "${input.clientId}"`
    );
  }

  return { paymentMethodId: row.id };
}

// ---------------------------------------------------------------------------
// removePaymentMethod
// ---------------------------------------------------------------------------
//
// NUNCA hace DELETE real -- un método de pago pudo haber sido referenciado
// por pagos históricos (client_payments.payment_method_id), y borrarlo
// físicamente rompería ese rastro de auditoría financiera (o forzaría un
// ON DELETE SET NULL/CASCADE que igual pierde información). En su lugar,
// esto es un soft-delete: marca status = 'removed', preservando la fila y
// toda su relación con pagos pasados para auditoría/reportes.
export async function removePaymentMethod(
  paymentMethodId: string,
  client?: PaymentMethodsClient
): Promise<void> {
  const resolved = resolveClient(client);

  const { error } = await resolved
    .from("client_payment_methods")
    .update({ status: "removed" })
    .eq("id", paymentMethodId);

  if (error) {
    throw new Error(
      `Failed to remove payment method "${paymentMethodId}": ${error.message}`
    );
  }
}
