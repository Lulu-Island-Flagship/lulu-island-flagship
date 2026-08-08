import { describe, it } from "node:test";
import assert from "node:assert";
import { generateJournalEntry } from "../../src/lib/journal-entry";
import type { BusinessEvent } from "../../src/lib/ledger-types";

function makeEvent(overrides: Partial<BusinessEvent> = {}): BusinessEvent {
  return {
    event_id: crypto.randomUUID(), event_type: "hold_captured",
    order_id: crypto.randomUUID(), user_id: crypto.randomUUID(),
    amount_cents: 25000, currency: "CAD", processor: "stripe",
    external_reference: "pi_test_123", occurred_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("generateJournalEntry", () => {
  it("genera al menos 2 filas", () => {
    assert.ok(generateJournalEntry(makeEvent()).length >= 2);
  });

  it("SUM(debitos) = SUM(creditos)", () => {
    const rows = generateJournalEntry(makeEvent());
    const d = rows.filter(r => r.cuenta_debito).reduce((s,r) => s + r.monto, 0);
    const c = rows.filter(r => r.cuenta_credito).reduce((s,r) => s + r.monto, 0);
    assert.strictEqual(d, c);
    assert.ok(d > 0);
  });

  it("hash SHA-256 de 64 chars hex por fila", () => {
    for (const row of generateJournalEntry(makeEvent()))
      assert.match(row.hash_sha256, /^[a-f0-9]{64}$/);
  });

  it("mismo ledger_id en todas las filas", () => {
    const ids = new Set(generateJournalEntry(makeEvent()).map(r => r.ledger_id));
    assert.strictEqual(ids.size, 1);
  });

  it("debito XOR credito por fila", () => {
    for (const row of generateJournalEntry(makeEvent()))
      assert.ok((row.cuenta_debito !== null) !== (row.cuenta_credito !== null));
  });

  it("rechaza event_type desconocido", () => {
    assert.throws(() => generateJournalEntry(makeEvent({ event_type: "no_existe" as any })));
  });

  it("monto 0 no lanza error (nonnegative en schema, CHECK en DB)", () => {
    const rows = generateJournalEntry(makeEvent({ amount_cents: 0 }));
    assert.ok(rows.length >= 2);
    assert.strictEqual(rows[0].monto, 0);
  });

  it("hold_captured: debito=1-1000, credito=1-1100", () => {
    const rows = generateJournalEntry(makeEvent({ event_type: "hold_captured" }));
    assert.strictEqual(rows.find(r => r.cuenta_debito)?.cuenta_debito, "1-1000");
    assert.strictEqual(rows.find(r => r.cuenta_credito)?.cuenta_credito, "1-1100");
  });

  it("payroll_disbursement: debito=5-2000, credito=1-1000", () => {
    const rows = generateJournalEntry(makeEvent({ event_type: "payroll_disbursement", processor: "internal" }));
    assert.strictEqual(rows.find(r => r.cuenta_debito)?.cuenta_debito, "5-2000");
    assert.strictEqual(rows.find(r => r.cuenta_credito)?.cuenta_credito, "1-1000");
  });

  it("estado por defecto es confirmado", () => {
    for (const row of generateJournalEntry(makeEvent()))
      assert.strictEqual(row.estado, "confirmado");
  });

  it("periodo_contable es YYYY-MM", () => {
    for (const row of generateJournalEntry(makeEvent({ occurred_at: "2026-08-06T14:30:00.000Z" })))
      assert.strictEqual(row.periodo_contable, "2026-08");
  });
});
