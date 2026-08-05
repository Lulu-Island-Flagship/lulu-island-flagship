import { describe, it } from "node:test";
import assert from "node:assert";
import {
  generateJournalEntry,
  replayOrderBalance,
  CHART_OF_ACCOUNTS,
  type BusinessEvent,
  type FinancialLedgerEntryForReplay,
} from "../../src/lib/financial-ledger";

// =========================================================================
// generateJournalEntry
// =========================================================================

describe("generateJournalEntry", () => {
  const baseEvent: Omit<BusinessEvent, "event_type" | "amount_cents" | "external_reference"> = {
    event_id: crypto.randomUUID(),
    order_id: "order_abc",
    user_id: "user_xyz",
    currency: "CAD",
    processor: "stripe",
    occurred_at: "2026-08-04T14:30:00.000Z",
    metadata: { internal_note: "test" },
  };

  it("genera exactamente 2 filas (débito + crédito) con el mismo ledger_id y monto", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 24750,
      external_reference: "pi_test123",
    };
    const rows = generateJournalEntry(event);

    assert.equal(rows.length, 2, "debe generar 2 filas");
    assert.equal(rows[0].ledger_id, rows[1].ledger_id, "mismo ledger_id");
    assert.equal(rows[0].monto, rows[1].monto, "mismo monto");
    assert.equal(rows[0].monto, 24750);
  });

  it("fila débito: cuenta_debito != null, cuenta_credito == null", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 10000,
      external_reference: "pi_debit",
    };
    const rows = generateJournalEntry(event);

    const debitRow = rows.find((r) => r.cuenta_debito !== null);
    const creditRow = rows.find((r) => r.cuenta_credito !== null);

    assert.ok(debitRow, "debe existir fila de débito");
    assert.ok(creditRow, "debe existir fila de crédito");
    assert.equal(debitRow!.cuenta_debito, CHART_OF_ACCOUNTS.EFECTIVO);
    assert.equal(debitRow!.cuenta_credito, null);
    assert.equal(creditRow!.cuenta_debito, null);
    assert.equal(creditRow!.cuenta_credito, CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR);
  });

  it("hash_sha256 es determinístico para el mismo contenido", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "balance_captured",
      amount_cents: 5000,
      external_reference: "pi_hash_test",
      occurred_at: "2026-08-04T00:00:00.000Z",
    };

    const rowsA = generateJournalEntry(event);
    const rowsB = generateJournalEntry(event);

    // Con mismo occurred_at string exacto, el hash debe ser idéntico
    assert.equal(rowsA[0].hash_sha256, rowsB[0].hash_sha256);
    assert.equal(rowsA[1].hash_sha256, rowsB[1].hash_sha256);
  });

  it("hash_sha256 cambia si el contenido difiere (integridad)", () => {
    const eventA: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 1000,
      external_reference: "pi_a",
    };
    const eventB: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 2000, // distinto monto
      external_reference: "pi_b",
    };

    const rowsA = generateJournalEntry(eventA);
    const rowsB = generateJournalEntry(eventB);

    assert.notEqual(rowsA[0].hash_sha256, rowsB[0].hash_sha256);
  });

  it("hash_sha256 tiene 64 caracteres hexadecimales", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 24750,
      external_reference: "pi_hex",
    };
    const rows = generateJournalEntry(event);

    for (const row of rows) {
      assert.equal(row.hash_sha256.length, 64, "hash debe tener 64 chars");
      assert.ok(/^[a-f0-9]{64}$/.test(row.hash_sha256), "hash debe ser hex");
    }
  });

  it("periodo_contable se deriva correctamente como YYYY-MM", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 1000,
      external_reference: "pi_periodo",
      occurred_at: "2026-08-04T14:30:00.000Z",
    };
    const rows = generateJournalEntry(event);

    for (const row of rows) {
      assert.equal(row.periodo_contable, "2026-08");
      assert.ok(/^\d{4}-\d{2}$/.test(row.periodo_contable));
    }
  });

  it("rechaza montos negativos (Zod validation)", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "paypal_refund",
      amount_cents: -500,
      external_reference: "txn_neg",
    };
    assert.throws(() => generateJournalEntry(event));
  });

  it("rechaza amount_cents no entero (Zod validation)", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 1999.6,
      external_reference: "pi_float",
    };
    assert.throws(() => generateJournalEntry(event));
  });

  it("acepta amount_cents = 0 (evento informativo sin movimiento real)", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_released",
      amount_cents: 0,
      external_reference: "pi_zero",
    };
    const rows = generateJournalEntry(event);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].monto, 0);
    assert.equal(rows[1].monto, 0);
  });

  it("hold_captured: débito a EFECTIVO, crédito a CUENTAS_POR_COBRAR", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 24750,
      external_reference: "pi_capture",
    };
    const rows = generateJournalEntry(event);
    const debitRow = rows.find((r) => r.cuenta_debito !== null)!;
    const creditRow = rows.find((r) => r.cuenta_credito !== null)!;

    assert.equal(debitRow.cuenta_debito, CHART_OF_ACCOUNTS.EFECTIVO);
    assert.equal(creditRow.cuenta_credito, CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR);
  });

  it("cancellation_penalty: débito a EFECTIVO, crédito a INGRESOS_PENALIDADES", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "cancellation_penalty",
      amount_cents: 5000,
      external_reference: "pi_penalty",
    };
    const rows = generateJournalEntry(event);
    const debitRow = rows.find((r) => r.cuenta_debito !== null)!;
    const creditRow = rows.find((r) => r.cuenta_credito !== null)!;

    assert.equal(debitRow.cuenta_debito, CHART_OF_ACCOUNTS.EFECTIVO);
    assert.equal(creditRow.cuenta_credito, CHART_OF_ACCOUNTS.INGRESOS_PENALIDADES);
  });

  it("warranty_refund: débito a REEMBOLSOS_EMITIDOS, crédito a EFECTIVO", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "warranty_refund",
      amount_cents: 5000,
      external_reference: null,
      processor: "internal",
    };
    const rows = generateJournalEntry(event);
    const debitRow = rows.find((r) => r.cuenta_debito !== null)!;
    const creditRow = rows.find((r) => r.cuenta_credito !== null)!;

    assert.equal(debitRow.cuenta_debito, CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS);
    assert.equal(creditRow.cuenta_credito, CHART_OF_ACCOUNTS.EFECTIVO);
  });

  it("hold_authorized: débito a FONDOS_RETENIDOS, crédito a DEPOSITOS_CONTINGENTES", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_authorized",
      amount_cents: 24750,
      external_reference: "pi_hold_auth",
    };
    const rows = generateJournalEntry(event);
    const debitRow = rows.find((r) => r.cuenta_debito !== null)!;
    const creditRow = rows.find((r) => r.cuenta_credito !== null)!;

    assert.equal(debitRow.cuenta_debito, CHART_OF_ACCOUNTS.FONDOS_RETENIDOS);
    assert.equal(creditRow.cuenta_credito, CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES);
  });

  it("hold_released: revierte el hold (débito a DEPOSITOS, crédito a FONDOS)", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_released",
      amount_cents: 24750,
      external_reference: "pi_released",
    };
    const rows = generateJournalEntry(event);
    const debitRow = rows.find((r) => r.cuenta_debito !== null)!;
    const creditRow = rows.find((r) => r.cuenta_credito !== null)!;

    assert.equal(debitRow.cuenta_debito, CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES);
    assert.equal(creditRow.cuenta_credito, CHART_OF_ACCOUNTS.FONDOS_RETENIDOS);
  });

  it("capture_failed: mismo asiento que hold_released", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "capture_failed",
      amount_cents: 20000,
      external_reference: "pi_failed",
    };
    const rows = generateJournalEntry(event);
    const debitRow = rows.find((r) => r.cuenta_debito !== null)!;

    assert.equal(debitRow.cuenta_debito, CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES);
  });

  it("wallet_full_payment_received: débito EFECTIVO, crédito CUENTAS_POR_COBRAR", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "wallet_full_payment_received",
      amount_cents: 10000,
      external_reference: null,
      processor: "internal",
    };
    const rows = generateJournalEntry(event);
    const debitRow = rows.find((r) => r.cuenta_debito !== null)!;

    assert.equal(debitRow.cuenta_debito, CHART_OF_ACCOUNTS.EFECTIVO);
  });

  it("wallet_refund: débito REEMBOLSOS_EMITIDOS, crédito EFECTIVO", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "wallet_refund",
      amount_cents: 10000,
      external_reference: null,
      processor: "internal",
    };
    const rows = generateJournalEntry(event);
    const debitRow = rows.find((r) => r.cuenta_debito !== null)!;
    const creditRow = rows.find((r) => r.cuenta_credito !== null)!;

    assert.equal(debitRow.cuenta_debito, CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS);
    assert.equal(creditRow.cuenta_credito, CHART_OF_ACCOUNTS.EFECTIVO);
  });

  it("todas las filas tienen moneda CAD y estado confirmado", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "balance_captured",
      amount_cents: 15000,
      external_reference: "pi_cad",
    };
    const rows = generateJournalEntry(event);
    for (const row of rows) {
      assert.equal(row.moneda, "CAD");
      assert.equal(row.estado, "confirmado");
    }
  });

  it("creado_por usa user_id cuando existe, 'system' cuando no", () => {
    const eventWithUser: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 1000,
      external_reference: "pi_user",
      user_id: "user_abc",
    };
    const rowsWithUser = generateJournalEntry(eventWithUser);
    for (const row of rowsWithUser) {
      assert.equal(row.creado_por, "user_abc");
    }

    const eventNoUser: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 1000,
      external_reference: "pi_nouser",
      user_id: null,
    };
    const rowsNoUser = generateJournalEntry(eventNoUser);
    for (const row of rowsNoUser) {
      assert.equal(row.creado_por, "system");
    }
  });

  it("cada fila pasa validación Zod (JournalEntryRowSchema)", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "paypal_advance_received",
      amount_cents: 30000,
      external_reference: "pp_txn_1",
      processor: "paypal",
    };
    const rows = generateJournalEntry(event);

    // Si generateJournalEntry no lanza, la validación Zod interna pasó
    // (JournalEntryRowSchema.parse se llama dentro)
    assert.equal(rows.length, 2);
    // Verificar campos clave que Zod validaría
    for (const row of rows) {
      assert.ok(row.hash_sha256.length === 64);
      assert.ok(/^\d{4}-\d{2}$/.test(row.periodo_contable));
      assert.equal(row.moneda, "CAD");
    }
  });

  it("referencia incluye order_id, user_id, processor, external_reference y metadata", () => {
    const event: BusinessEvent = {
      ...baseEvent,
      event_type: "hold_captured",
      amount_cents: 1000,
      external_reference: "pi_ref",
      order_id: "order_test_ref",
      user_id: "user_test_ref",
      processor: "stripe",
      metadata: { custom_field: "value" },
    };
    const rows = generateJournalEntry(event);

    for (const row of rows) {
      assert.equal(row.referencia.order_id, "order_test_ref");
      assert.equal(row.referencia.user_id, "user_test_ref");
      assert.equal(row.referencia.processor, "stripe");
      assert.equal(row.referencia.external_reference, "pi_ref");
      assert.equal(row.referencia.custom_field, "value");
    }
  });
});

// =========================================================================
// replayOrderBalance
// =========================================================================

describe("replayOrderBalance", () => {
  it("suma cobros (débito EFECTIVO, crédito CUENTAS_POR_COBRAR)", () => {
    const entries: FinancialLedgerEntryForReplay[] = [
      { cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO, cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR, monto: 24750 },
      { cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO, cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR, monto: 20000 },
    ];
    const balance = replayOrderBalance(entries);
    assert.equal(balance.totalCollectedCents, 44750);
    assert.equal(balance.totalRefundedCents, 0);
    assert.equal(balance.netCents, 44750);
  });

  it("incluye penalidades como cobro (débito EFECTIVO, crédito INGRESOS_PENALIDADES)", () => {
    const entries: FinancialLedgerEntryForReplay[] = [
      { cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO, cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR, monto: 20000 },
      { cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO, cuenta_credito: CHART_OF_ACCOUNTS.INGRESOS_PENALIDADES, monto: 5000 },
    ];
    const balance = replayOrderBalance(entries);
    assert.equal(balance.totalCollectedCents, 25000);
    assert.equal(balance.netCents, 25000);
  });

  it("resta reembolsos (débito REEMBOLSOS_EMITIDOS, crédito EFECTIVO)", () => {
    const entries: FinancialLedgerEntryForReplay[] = [
      { cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO, cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR, monto: 44750 },
      { cuenta_debito: CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS, cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO, monto: 5000 },
    ];
    const balance = replayOrderBalance(entries);
    assert.equal(balance.totalCollectedCents, 44750);
    assert.equal(balance.totalRefundedCents, 5000);
    assert.equal(balance.netCents, 39750);
  });

  it("ignora holds (FONDOS_RETENIDOS ↔ DEPOSITOS_CONTINGENTES) — no afectan caja", () => {
    const entries: FinancialLedgerEntryForReplay[] = [
      // hold autorizado
      { cuenta_debito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS, cuenta_credito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES, monto: 24750 },
      // captura real
      { cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO, cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR, monto: 24750 },
      // hold liberado (no capturado)
      { cuenta_debito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES, cuenta_credito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS, monto: 10000 },
    ];
    const balance = replayOrderBalance(entries);
    assert.equal(balance.totalCollectedCents, 24750); // solo la captura real
    assert.equal(balance.totalRefundedCents, 0);
    assert.equal(balance.netCents, 24750);
  });

  it("capture_failed tampoco afecta caja (DEPOSITOS → FONDOS)", () => {
    const entries: FinancialLedgerEntryForReplay[] = [
      { cuenta_debito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS, cuenta_credito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES, monto: 20000 },
      { cuenta_debito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES, cuenta_credito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS, monto: 20000 },
    ];
    const balance = replayOrderBalance(entries);
    assert.equal(balance.netCents, 0);
  });

  it("lista vacía devuelve todo en cero", () => {
    const balance = replayOrderBalance([]);
    assert.equal(balance.totalCollectedCents, 0);
    assert.equal(balance.totalRefundedCents, 0);
    assert.equal(balance.netCents, 0);
  });

  it("netCents = totalCollectedCents - totalRefundedCents", () => {
    const entries: FinancialLedgerEntryForReplay[] = [
      { cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO, cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR, monto: 50000 },
      { cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO, cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR, monto: 25000 },
      { cuenta_debito: CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS, cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO, monto: 15000 },
      { cuenta_debito: CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS, cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO, monto: 5000 },
    ];
    const balance = replayOrderBalance(entries);
    assert.equal(balance.totalCollectedCents, 75000);
    assert.equal(balance.totalRefundedCents, 20000);
    assert.equal(balance.netCents, 75000 - 20000);
  });
});
