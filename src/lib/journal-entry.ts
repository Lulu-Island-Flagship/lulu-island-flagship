/**
 * Capa 0 — Journal Entry Generator.
 *
 * Responsabilidad única: transformar un `BusinessEvent` en un asiento
 * contable de partida doble (Journal Entry) con al menos 2 filas
 * (una débito, una crédito) que comparten el mismo `ledger_id`.
 *
 * Principios:
 *  - Event-aware, NO event-driven. El caller invoca generateJournalEntry()
 *    dentro de su propia transacción DB.
 *  - La función es pura: no toca base de datos. Devuelve las filas listas
 *    para insertar.
 *  - Validación Zod en entrada y salida.
 *  - Invariante contable: SUM(débitos) = SUM(créditos).
 *  - Hash SHA-256 por fila vía computeLedgerRowHash.
 */

import { CHART_OF_ACCOUNTS, type CuentaContable } from "./chart-of-accounts";
import type { BusinessEvent, BusinessEventType, JournalEntryRow } from "./ledger-types";
import { BusinessEventSchema, JournalEntryRowSchema } from "./ledger-types";
import { computeLedgerRowHash } from "./ledger-hash";

// =========================================================================
// Helpers
// =========================================================================

/**
 * Deriva el periodo contable (YYYY-MM) de una fecha ISO.
 */
function toPeriodoContable(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * Normaliza una fecha (Date | string) a ISO string.
 */
function toISOString(occurredAt: Date | string): string {
  return typeof occurredAt === "string" ? occurredAt : occurredAt.toISOString();
}

// =========================================================================
// Mapa de EventType → (cuenta_debito, cuenta_credito, descripcion)
// =========================================================================

interface AccountMapping {
  cuenta_debito: CuentaContable | null;
  cuenta_credito: CuentaContable | null;
  descripcion: string;
}

/**
 * Mapa canónico de cada tipo de evento de negocio a su asiento contable.
 *
 * Cada entrada define la cuenta que recibe el débito y la cuenta que recibe
 * el crédito. La función generateJournalEntry parte este par en dos filas
 * (una débito, una crédito) que comparten el mismo ledger_id y monto.
 *
 * Principio contable: el débito representa "a dónde va el valor", el crédito
 * representa "de dónde sale el valor".
 */
const EVENT_ACCOUNT_MAP: Record<BusinessEventType, AccountMapping> = {
  // ── Cobros (dinero entra a la empresa) ──────────────────────────────
  hold_captured: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    descripcion: "Captura de hold — cobro efectivo",
  },
  balance_captured: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    descripcion: "Captura de saldo pendiente — cobro efectivo",
  },
  paypal_advance_received: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    descripcion: "Anticipo PayPal recibido",
  },
  wallet_full_payment_received: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    descripcion: "Pago completo vía billetera",
  },

  // ── Penalidad de cancelación (ingreso distinto a servicio) ─────────
  cancellation_penalty: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.INGRESOS_PENALIDADES,
    descripcion: "Penalidad por cancelación",
  },

  // ── Reembolsos (dinero sale de la empresa) ──────────────────────────
  paypal_refund: {
    cuenta_debito: CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Reembolso vía PayPal",
  },
  warranty_refund: {
    cuenta_debito: CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Reembolso por garantía",
  },
  wallet_refund: {
    cuenta_debito: CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Reembolso a billetera",
  },

  // ── Holds (informativos — no mueven efectivo real, pero se registran) ─
  hold_authorized: {
    cuenta_debito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS,
    cuenta_credito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES,
    descripcion: "Hold autorizado — fondos retenidos por procesador",
  },
  hold_released: {
    cuenta_debito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES,
    cuenta_credito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS,
    descripcion: "Hold liberado — fondos devueltos al cliente",
  },
  capture_failed: {
    cuenta_debito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES,
    cuenta_credito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS,
    descripcion: "Captura fallida — hold no convertido",
  },

  // ── Capa 5: Tax Engine ────────────────────────────────────────────
  tax_gst_accrual: {
    cuenta_debito: CHART_OF_ACCOUNTS.INGRESOS_SERVICIOS_4010,
    cuenta_credito: CHART_OF_ACCOUNTS.GST_PAYABLE,
    descripcion: "Devengo GST — ingreso del periodo contra GST por pagar",
  },
  tax_pst_accrual: {
    cuenta_debito: CHART_OF_ACCOUNTS.INGRESOS_SERVICIOS_4010,
    cuenta_credito: CHART_OF_ACCOUNTS.PST_PAYABLE,
    descripcion: "Devengo PST — ingreso del periodo contra PST por pagar",
  },

  // ── Capa 7: AR B2B ────────────────────────────────────────────────
  ar_invoice_generated: {
    cuenta_debito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR_AR,
    cuenta_credito: CHART_OF_ACCOUNTS.INGRESOS_SERVICIOS_4010,
    descripcion: "Factura B2B emitida — devengo de ingreso por servicios",
  },
  ar_payment_received: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR_AR,
    descripcion: "Cobro de factura B2B — efectivo recibido contra AR",
  },

  // ── Capa 7: Bank Reconciliation ───────────────────────────────────
  bank_reconciled: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Conciliación bancaria — match confirmado (no afecta saldo neto)",
  },
  payroll_disbursement: {
    cuenta_debito: CHART_OF_ACCOUNTS.NOMINA,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Pago de nómina — desembolso de salarios",
  },
  client_invoice_generated: {
    cuenta_debito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    cuenta_credito: CHART_OF_ACCOUNTS.INGRESOS_SERVICIOS,
    descripcion: "Factura de cliente emitida — devengo de ingreso por servicios",
  },
  client_payment_received: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    descripcion: "Cobro de factura de cliente — efectivo recibido contra AR",
  },
};

// =========================================================================
// generateJournalEntry — función principal
// =========================================================================

/**
 * Genera un asiento contable de partida doble a partir de un evento de
 * negocio.
 *
 * Cada llamada produce al menos 2 filas (una débito, una crédito) que
 * comparten el mismo `ledger_id` y suman el mismo monto. Esto garantiza
 * la ecuación contable fundamental: ACTIVO = PASIVO + PATRIMONIO.
 *
 * La función es pura: no toca la base de datos. El caller es responsable
 * de insertar las filas devueltas en `financial_ledger` dentro de la misma
 * transacción DB que originó el evento.
 *
 * @param event — Evento de negocio validado contra BusinessEventSchema
 * @returns Array de JournalEntryRow (mínimo 2: débito + crédito)
 * @throws {Error} si el evento no tiene un mapping contable definido
 */
export function generateJournalEntry(event: BusinessEvent): JournalEntryRow[] {
  // 1. Validar entrada con Zod
  const parsed = BusinessEventSchema.parse(event);

  // 2. Obtener mapping contable del evento
  const mapping = EVENT_ACCOUNT_MAP[parsed.event_type];
  if (!mapping) {
    throw new Error(
      `generateJournalEntry: no hay mapping contable para event_type=${parsed.event_type}`
    );
  }

  // 3. Derivar campos comunes
  const ledgerId = crypto.randomUUID();
  const timestamp = toISOString(parsed.occurred_at);
  const periodo = toPeriodoContable(timestamp);
  const monto = parsed.amount_cents;
  const createdBy = parsed.user_id ?? "system";
  const descripcionBase = mapping.descripcion;

  const referencia: Record<string, unknown> = {
    order_id: parsed.order_id,
    user_id: parsed.user_id,
    processor: parsed.processor,
    external_reference: parsed.external_reference,
    currency: parsed.currency,
    ...(parsed.metadata ?? {}),
  };

  // 4. Construir las dos filas (débito y crédito)
  const rows: Omit<JournalEntryRow, "hash_sha256">[] = [];

  // Fila DÉBITO
  if (mapping.cuenta_debito) {
    rows.push({
      ledger_id: ledgerId,
      event_id: parsed.event_id,
      event_type: parsed.event_type,
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: mapping.cuenta_debito,
      cuenta_credito: null,
      monto,
      moneda: "CAD",
      descripcion: `${descripcionBase} [DÉBITO] — ${parsed.order_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado",
      creado_por: createdBy,
    });
  }

  // Fila CRÉDITO
  if (mapping.cuenta_credito) {
    rows.push({
      ledger_id: ledgerId,
      event_id: parsed.event_id,
      event_type: parsed.event_type,
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: null,
      cuenta_credito: mapping.cuenta_credito,
      monto,
      moneda: "CAD",
      descripcion: `${descripcionBase} [CRÉDITO] — ${parsed.order_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado",
      creado_por: createdBy,
    });
  }

  // 5. Invariante: debe haber al menos 2 filas (una débito, una crédito)
  if (rows.length < 2) {
    throw new Error(
      `generateJournalEntry: invariante rota — se esperaban ≥2 filas, se generaron ${rows.length}. ` +
        `event_type=${parsed.event_type}, cuenta_debito=${mapping.cuenta_debito}, cuenta_credito=${mapping.cuenta_credito}`
    );
  }

  // 6. Invariante: la suma de montos en filas con débito debe igualar la suma en filas con crédito
  const sumDebito = rows
    .filter((r) => r.cuenta_debito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  const sumCredito = rows
    .filter((r) => r.cuenta_credito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  if (sumDebito !== sumCredito) {
    throw new Error(
      `generateJournalEntry: invariante contable rota — SUM(débito)=${sumDebito} ≠ SUM(crédito)=${sumCredito}. ` +
        `ledger_id=${ledgerId}, event_type=${parsed.event_type}`
    );
  }

  // 7. Calcular hash SHA-256 de cada fila y devolver con Zod validation
  return rows.map((row) => {
    const hash = computeLedgerRowHash(row);
    return JournalEntryRowSchema.parse({ ...row, hash_sha256: hash });
  });
}
