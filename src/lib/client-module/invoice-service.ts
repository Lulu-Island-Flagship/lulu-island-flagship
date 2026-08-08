import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "../hiring-flow/settings-service";
import { getHiringFlowServiceClient } from "@/lib/supabase-service-client";
import {
  calculateInvoiceTotals,
  generateInvoiceNumber,
  type InvoiceTotals,
  type LineItemInput,
} from "./billing-calculations";
import {
  generateInvoiceJournalEntry,
  type ClientInvoice,
} from "@/lib/billing-to-ledger";

// Módulo nuevo y separado: "Módulo de Cliente" -- facturación. Creación de
// facturas (client_invoices + client_invoice_line_items).
//
// Tablas asumidas (otro agente las está creando en paralelo, contrato
// acordado, NO se crean ni se stubean aquí):
//   client_invoices(id UUID, client_id UUID, invoice_number TEXT,
//     issue_date DATE, due_date DATE,
//     status TEXT CHECK IN ('draft','sent','paid','partially_paid',
//       'overdue','void'),
//     subtotal_cents INTEGER, gst_amount_cents INTEGER,
//     pst_amount_cents INTEGER, total_cents INTEGER,
//     amount_paid_cents INTEGER, balance_due_cents INTEGER,
//     created_at, updated_at)
//   client_invoice_line_items(id UUID, invoice_id UUID,
//     property_service_id UUID NULL, description TEXT, quantity NUMERIC,
//     unit_price_cents INTEGER, amount_cents INTEGER, created_at)
//
// tax_gst_rate / tax_pst_rate_bc se leen de system_settings vía
// getSetting() (../hiring-flow/settings-service, genérico, ya usado por
// otros módulos de este repo) -- NUNCA hardcodeadas aquí ni en
// billing-calculations.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InvoiceServiceClient = SupabaseClient<any, "public", any>;

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export class InvoiceCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceCreationError";
  }
}

// [OBSOLETO tras el retrofit a RPC atómica -- ver "Nota de atomicidad"
// abajo] Existía para el caso en que insertar las líneas fallaba Y el
// intento de compensación (borrar la factura recién creada) TAMBIÉN
// fallaba, dejando una factura huérfana en 'draft' sin líneas que requería
// limpieza manual. Ese caso ya NO puede ocurrir: `createInvoice` ahora
// llama a una única función RPC (`create_client_invoice_with_line_items`,
// migración 281) que inserta la factura y todas sus líneas dentro de una
// sola transacción real de Postgres -- si cualquier INSERT falla, TODO se
// revierte automáticamente y nunca queda un rastro parcial en la DB, así
// que ya no hay "compensación" que pueda fallar.
//
// Se deja la clase exportada (en vez de eliminarla) por si algún caller
// externo ya hace `err instanceof OrphanedInvoiceError` en algún catch --
// eliminarla sería un breaking change silencioso de la superficie pública
// de este módulo. Nunca se lanza desde este archivo. Candidata a
// eliminación real en un futuro cleanup una vez confirmado que ningún
// caller la referencia (mismo criterio que se aplicó a
// `OrphanedCandidateError` en candidate-step1-service.ts tras la migración
// 268, donde sí se eliminó por completo porque no tenía uso externo
// conocido -- acá se prefiere la opción más conservadora porque este
// archivo, a diferencia de aquel, no se auditó explícitamente en busca de
// usos externos de OrphanedInvoiceError antes de este retrofit).
export class OrphanedInvoiceError extends InvoiceCreationError {
  readonly invoiceId: string;
  readonly lineItemsError: string;
  readonly compensationError: string;

  constructor(invoiceId: string, lineItemsError: string, compensationError: string) {
    super(
      `Invoice "${invoiceId}" was created but its line items failed to insert AND ` +
        `compensation (deleting the orphaned invoice) also failed. Manual cleanup ` +
        `required. Line items error: ${lineItemsError}. Compensation error: ${compensationError}`
    );
    this.name = "OrphanedInvoiceError";
    this.invoiceId = invoiceId;
    this.lineItemsError = lineItemsError;
    this.compensationError = compensationError;
  }
}

// ---------------------------------------------------------------------------
// Nota de atomicidad factura + líneas (actualizada tras el retrofit)
// ---------------------------------------------------------------------------
//
// Mismo problema, y misma decisión, que hiring-flow/candidate-step1-service.ts
// tuvo ANTES de que se le agregara una RPC atómica (migración 268): el
// cliente REST de Supabase no ofrece una transacción real entre dos
// `.insert()` separados. La primera versión de este archivo resolvía esto
// con un saga con compensación (insertar factura -> insertar líneas -> si
// fallaba, borrar la factura) que dejaba una ventana real: si la
// compensación TAMBIÉN fallaba, quedaba una factura huérfana en 'draft'
// sin líneas.
//
// Fix: supabase/migrations/281_client_module_billing_create_invoice_atomic.sql
// agrega `create_client_invoice_with_line_items(...)`, una función RPC
// SECURITY DEFINER (mismo patrón que `submit_step1_candidate`, migración
// 268, y `set_current_fixed_costs`/`set_system_setting`, 249/252) que
// inserta client_invoices + TODAS sus client_invoice_line_items dentro de
// una única transacción de Postgres real. Si cualquier INSERT de línea
// falla, Postgres revierte todo -- nunca puede quedar una factura sin
// líneas, y ya no hace falta ninguna lógica de compensación en esta capa.
// `OrphanedInvoiceError` queda documentada como obsoleta arriba en vez de
// eliminarse -- ver esa nota para el porqué de esa decisión puntual.
//
// Como la factura siempre nace en 'draft' (nunca 'sent', ver la RPC), una
// factura en 'draft' nunca es visible a clientes ni se puede enviar/cobrar
// por accidente -- eso ya reducía el impacto del peor caso incluso antes
// de este retrofit, aunque ahora el peor caso (huérfana) directamente no
// puede ocurrir.

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

function resolveClient(client?: InvoiceServiceClient): InvoiceServiceClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a client_invoices"
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Dependencias inyectables (mismo patrón que client-consent-service.ts /
// candidate-step1-service.ts: cada dependencia externa es un parámetro
// opcional cuyo default es la implementación real importada, para poder
// testear sin mockear Supabase real).
// ---------------------------------------------------------------------------

export type GetSettingFn = typeof getSetting;

export interface CreateInvoiceRpcParams {
  clientId: string;
  issueDate: Date;
  dueDate: Date;
  totals: InvoiceTotals;
  invoiceNumber: string;
  lineItems: LineItemInput[];
}

// Reemplaza a InsertInvoiceFn + InsertLineItemsFn + DeleteInvoiceFn de la
// versión anterior (saga con compensación). Ahora es una sola operación
// atómica -- ver "Nota de atomicidad" arriba y
// supabase/migrations/281_client_module_billing_create_invoice_atomic.sql.
export type CallCreateInvoiceRpcFn = (
  params: CreateInvoiceRpcParams,
  client: InvoiceServiceClient
) => Promise<string>;

// Implementación real de CallCreateInvoiceRpcFn: un solo round-trip a la
// RPC atómica `create_client_invoice_with_line_items` (281) -- factura
// SIEMPRE con status='draft' (regla de negocio explícita, aplicada dentro
// de la función SQL: una factura nunca se crea directo en 'sent' u otro
// estado; el envío/transición a 'sent' es una acción separada, fuera de
// este servicio) y todas sus líneas, o ninguna de las dos cosas.
async function defaultCallCreateInvoiceRpc(
  params: CreateInvoiceRpcParams,
  client: InvoiceServiceClient
): Promise<string> {
  const lineItemsPayload = params.lineItems.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit_price_cents: item.unitPriceCents,
    amount_cents: Math.round(item.quantity * item.unitPriceCents),
    property_service_id: item.propertyServiceId ?? null,
  }));

  const { data, error } = await client.rpc("create_client_invoice_with_line_items", {
    p_client_id: params.clientId,
    p_issue_date: toDateOnly(params.issueDate),
    p_due_date: toDateOnly(params.dueDate),
    p_subtotal_cents: params.totals.subtotalCents,
    p_gst_amount_cents: params.totals.gstAmountCents,
    p_pst_amount_cents: params.totals.pstAmountCents,
    p_total_cents: params.totals.totalCents,
    p_invoice_number: params.invoiceNumber,
    p_line_items: lineItemsPayload,
  });

  // create_client_invoice_with_line_items RETURNS client_invoices (una
  // sola fila). Si la RPC lanzó una excepción de Postgres (ej. el guard de
  // "sin líneas" dentro de la función), llega acá como `error`, no como
  // excepción de JS -- se relanza como InvoiceCreationError para que el
  // resto del flujo (y los tests) lo traten igual que cualquier otro
  // fallo de inserción.
  if (error || !data) {
    throw new InvoiceCreationError(
      `create_client_invoice_with_line_items RPC failed for client "${params.clientId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.id) {
    throw new InvoiceCreationError(
      "create_client_invoice_with_line_items RPC returned no data (expected an invoice row with id)"
    );
  }
  return row.id as string;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Fix (auditoría 2026-07-31, hallazgo #14): la versión anterior usaba
// `Date.now()` como sequenceNumber -- riesgo real de colisión bajo carga
// concurrente (dos facturas creadas en el mismo milisegundo, ej. batch de
// facturación mensual), y un timestamp de 13 dígitos tampoco produce el
// formato "INV-<año>-000123" legible que generateInvoiceNumber() espera.
// Ahora se obtiene un secuencial atómico real vía
// `next_client_invoice_number_sequence()` (RPC SECURITY DEFINER sobre una
// SEQUENCE nativa de Postgres, migración 290) -- `nextval()` es atómico a
// nivel de motor, dos transacciones concurrentes nunca reciben el mismo
// valor, sin necesidad de lock explícito en esta capa.
export type GetNextInvoiceSequenceFn = (
  client: InvoiceServiceClient
) => Promise<number>;

async function defaultGetNextInvoiceSequence(
  client: InvoiceServiceClient
): Promise<number> {
  const { data, error } = await client.rpc("next_client_invoice_number_sequence");
  if (error || data === null || data === undefined) {
    throw new InvoiceCreationError(
      `next_client_invoice_number_sequence RPC failed: ${error?.message ?? "no data returned"}`
    );
  }
  // La secuencia es BIGINT -- Supabase/PostgREST puede serializarla como
  // string o number según el driver; se normaliza a number (Number.MAX_SAFE_INTEGER
  // es ~9x10^15, muy por encima de cualquier volumen real de facturas de
  // este negocio, así que la conversión es segura en la práctica).
  return Number(data);
}

// Fix (auditoría externa 2026-07-31, hallazgo #5, alcance acotado): GST/PST
// se aplicaban siempre sobre el subtotal completo, sin excepción -- un
// cliente comercial con exención de PST real (certificado vigente ante BC)
// recibía una factura con PST cobrado de más, e inválida como comprobante
// fiscal para ese cliente. `clients.pst_exemption_number` (migración 269) ya
// existe en el esquema como el campo pensado para este dato -- se usa aquí
// tal cual: si el cliente tiene un número de exención de PST no vacío,
// pstRate efectivo = 0 para esta factura. GST NO se exime -- no existe una
// exención general de GST federal para servicios de limpieza comercial en
// Canadá (el gst_number del cliente es para fines de registro/ITC del
// propio cliente, no una exención del cobro), así que gstRate nunca se toca
// aquí. No se valida el FORMATO/vigencia real del número ante BC (ese
// mismo criterio ya se documentó en la migración 269 para gst_number/
// pst_exemption_number: la validación de formato es responsabilidad de un
// servicio aparte, no de este código) -- la responsabilidad de mantener ese
// campo correcto es de quien administra el perfil del cliente.
export type GetClientPstExemptionFn = (
  clientId: string,
  client: InvoiceServiceClient
) => Promise<boolean>;

async function defaultGetClientPstExemption(
  clientId: string,
  client: InvoiceServiceClient
): Promise<boolean> {
  const { data, error } = await client
    .from("clients")
    .select("pst_exemption_number")
    .eq("id", clientId)
    .single();
  if (error || !data) {
    // Fallar cerrado: si no se puede confirmar la exención, se cobra PST
    // normal (comportamiento histórico) -- nunca se asume una exención que
    // no se pudo verificar.
    return false;
  }
  const exemptionNumber = (data as { pst_exemption_number: string | null }).pst_exemption_number;
  return !!exemptionNumber && exemptionNumber.trim().length > 0;
}

async function buildInvoiceNumber(
  issueDate: Date,
  client: InvoiceServiceClient,
  getNextInvoiceSequenceFn: GetNextInvoiceSequenceFn
): Promise<string> {
  const sequenceNumber = await getNextInvoiceSequenceFn(client);
  return generateInvoiceNumber(issueDate, sequenceNumber);
}

// ---------------------------------------------------------------------------
// createInvoice
// ---------------------------------------------------------------------------

export interface CreateInvoiceParams {
  clientId: string;
  lineItems: LineItemInput[];
  issueDate: Date;
  dueDateDays: number;
  client?: InvoiceServiceClient;

  // Dependencias inyectables (default = implementación real importada).
  getSettingFn?: GetSettingFn;
  callCreateInvoiceRpcFn?: CallCreateInvoiceRpcFn;
  getNextInvoiceSequenceFn?: GetNextInvoiceSequenceFn;
  getClientPstExemptionFn?: GetClientPstExemptionFn;
}

export interface CreateInvoiceResult {
  invoiceId: string;
  totals: InvoiceTotals;
}

export async function createInvoice(
  params: CreateInvoiceParams
): Promise<CreateInvoiceResult> {
  // Nunca una factura sin líneas -- validado ANTES de tocar la DB, ni
  // siquiera se leen las tasas de impuestos si esto falla. (La RPC
  // también revalida esto dentro de la transacción, defensa en
  // profundidad -- ver migración 281 -- pero fallar acá primero evita un
  // round-trip innecesario.)
  if (!params.lineItems || params.lineItems.length === 0) {
    throw new InvoiceCreationError(
      `Cannot create invoice for client "${params.clientId}": lineItems must not be empty`
    );
  }

  const getSettingImpl = params.getSettingFn ?? getSetting;
  const callCreateInvoiceRpcImpl = params.callCreateInvoiceRpcFn ?? defaultCallCreateInvoiceRpc;
  const getNextInvoiceSequenceImpl = params.getNextInvoiceSequenceFn ?? defaultGetNextInvoiceSequence;
  const getClientPstExemptionImpl = params.getClientPstExemptionFn ?? defaultGetClientPstExemption;

  const resolved = resolveClient(params.client);

  // Tasas siempre desde system_settings, nunca hardcodeadas -- ver
  // billing-calculations.ts.
  const gstRate = (await getSettingImpl("tax_gst_rate", resolved)) as number;
  const pstRateBase = (await getSettingImpl("tax_pst_rate_bc", resolved)) as number;

  // Fix (auditoría externa 2026-07-31, hallazgo #5): PST efectivo = 0 si el
  // cliente tiene un número de exención de PST registrado -- ver comentario
  // de defaultGetClientPstExemption más abajo. GST nunca se exime aquí.
  const isPstExempt = await getClientPstExemptionImpl(params.clientId, resolved);
  const pstRate = isPstExempt ? 0 : pstRateBase;

  const totals = calculateInvoiceTotals(params.lineItems, gstRate, pstRate);

  const dueDate = addDays(params.issueDate, params.dueDateDays);
  const invoiceNumber = await buildInvoiceNumber(params.issueDate, resolved, getNextInvoiceSequenceImpl);

  // Factura + TODAS sus líneas en una sola operación atómica (RPC
  // create_client_invoice_with_line_items, 281 -- ver "Nota de
  // atomicidad" arriba). Un solo round-trip, una sola transacción de
  // Postgres: todo o nada, ya no hace falta saga ni compensación.
  const invoiceId = await callCreateInvoiceRpcImpl(
    { clientId: params.clientId, issueDate: params.issueDate, dueDate, totals, invoiceNumber, lineItems: params.lineItems },
    resolved
  );

  // ── Pipeline: Billing → Financial Ledger ──────────────────────────
  // Registrar el devengo contable de la factura en el libro mayor.
  // Fire-and-forget: la factura ya está creada; un fallo aquí no la revierte.
  try {
    const { data: invoiceRow, error: fetchError } = await resolved
      .from("client_invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (!fetchError && invoiceRow) {
      const journalRows = generateInvoiceJournalEntry(invoiceRow as ClientInvoice);
      const { error: ledgerError } = await resolved
        .from("financial_ledger")
        .insert(journalRows);
      if (ledgerError) {
        console.error("billing-to-ledger: invoice journal insert failed", ledgerError);
      }
    } else if (fetchError) {
      console.error("billing-to-ledger: failed to fetch invoice for journal", fetchError);
    }
  } catch (bridgeError) {
    console.error("billing-to-ledger: unexpected bridge error", bridgeError);
  }

  return { invoiceId, totals };
}
