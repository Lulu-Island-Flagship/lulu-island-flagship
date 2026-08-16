/**
 * E3 — INST-FIN-003 (double-execution replay).
 *
 * "Toda mutación monetaria es idempotente (clave + UNIQUE); los asientos
 * publicados no se editan ni borran (solo compensación tipificada)."
 *
 * La regla se materializa en dos capas:
 *
 *  1. Shadow Ledger (`src/lib/shadow-ledger.ts`):
 *     - `buildIdempotencyKey` genera la clave determinística.
 *     - `buildShadowLedgerEntry` arma el registro a insertar con esa clave.
 *     - La BD garantiza el dedupe: `shadow_ledger_entries.idempotency_key
 *       TEXT NOT NULL UNIQUE` (migración 081) y los RPC atómicos insertan con
 *       `ON CONFLICT (idempotency_key) DO NOTHING` (migraciones 312 y 313).
 *
 *  2. Financial Ledger (`src/lib/journal-entry.ts` → `generateJournalEntry`):
 *     - `event_id` (provisto por el caller) es la clave de idempotencia; se
 *       propaga intacta a todas las filas del asiento y el contenido (incluido
 *       `hash_sha256`) es determinístico entre replays.
 *
 * PROTOCOLO §6: aquí se mockea SOLO la frontera de almacenamiento (una tabla
 * fake con la semántica UNIQUE + ON CONFLICT DO NOTHING de la BD). La lógica
 * interna (`buildShadowLedgerEntry`, `buildIdempotencyKey`,
 * `generateJournalEntry`) corre real, sin mockear.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildIdempotencyKey,
  buildShadowLedgerEntry,
  type BuildShadowLedgerEntryInput,
  type ShadowLedgerEntryRecord,
} from "../../src/lib/shadow-ledger";
import { generateJournalEntry } from "../../src/lib/journal-entry";
import type { BusinessEvent } from "../../src/lib/ledger-types";

// ---------------------------------------------------------------------------
// Frontera de almacenamiento fake — replica SOLO la semántica de BD, nunca la
// lógica de negocio.
// ---------------------------------------------------------------------------

/**
 * Réplica de `shadow_ledger_entries` con su única restricción de idempotencia:
 * `idempotency_key TEXT NOT NULL UNIQUE` + `INSERT ... ON CONFLICT DO NOTHING`.
 */
class FakeShadowLedgerTable {
  readonly rows: ShadowLedgerEntryRecord[] = [];
  private readonly keys = new Set<string>();

  /** Devuelve `true` si insertó; `false` si la clave ya existía (DO NOTHING). */
  insert(entry: ShadowLedgerEntryRecord): boolean {
    if (this.keys.has(entry.idempotency_key)) return false;
    this.keys.add(entry.idempotency_key);
    this.rows.push(entry);
    return true;
  }

  get size(): number {
    return this.rows.length;
  }
}

/**
 * Réplica de `financial_ledger` con dedupe por `event_id` a nivel de asiento
 * (un mismo evento publicado no reinserta su grupo débito+crédito).
 */
class FakeFinancialLedgerTable {
  readonly rows: { event_id: string; hash_sha256: string }[] = [];
  private readonly postedEventIds = new Set<string>();

  /** Devuelve la cantidad de filas insertadas (0 si el evento ya estaba publicado). */
  insertJournal(rows: { event_id: string; hash_sha256: string }[]): number {
    if (rows.length === 0) return 0;
    const eventId = rows[0].event_id;
    if (this.postedEventIds.has(eventId)) return 0;
    this.postedEventIds.add(eventId);
    this.rows.push(...rows);
    return rows.length;
  }

  get size(): number {
    return this.rows.length;
  }
}

// ---------------------------------------------------------------------------
// Mutaciones a nivel de servicio: lógica interna real + frontera fake.
// ---------------------------------------------------------------------------

function postShadowLedgerMutation(
  table: FakeShadowLedgerTable,
  input: BuildShadowLedgerEntryInput,
): { inserted: boolean; entry: ShadowLedgerEntryRecord } {
  // buildShadowLedgerEntry es la lógica real (construye la clave determinística).
  const entry = buildShadowLedgerEntry(input);
  return { inserted: table.insert(entry), entry };
}

function makeShadowInput(
  overrides: Partial<BuildShadowLedgerEntryInput> = {},
): BuildShadowLedgerEntryInput {
  return {
    eventType: "hold_captured",
    orderId: "order_123",
    userId: "user_1",
    amountCents: 24750,
    processor: "stripe",
    externalReference: "pi_replay_001",
    occurredAt: "2026-08-06T14:30:00.000Z",
    ...overrides,
  };
}

function makeBusinessEvent(overrides: Partial<BusinessEvent> = {}): BusinessEvent {
  return {
    event_id: "8f2d3b9e-0000-4000-8000-000000000001",
    event_type: "hold_captured",
    order_id: "order_123",
    user_id: "user_1",
    amount_cents: 24750,
    currency: "CAD",
    processor: "stripe",
    external_reference: "pi_replay_001",
    occurred_at: "2026-08-06T14:30:00.000Z",
    ...overrides,
  };
}

describe("INST-FIN-003 · Shadow Ledger — double-execution replay", () => {
  it("repetir la misma mutación con la misma Idempotency-Key NO duplica fila", () => {
    const table = new FakeShadowLedgerTable();
    const input = makeShadowInput();

    const first = postShadowLedgerMutation(table, input);
    const second = postShadowLedgerMutation(table, input);

    // Primera ejecución inserta; la segunda colisiona en la UNIQUE y es DO NOTHING.
    assert.strictEqual(first.inserted, true);
    assert.strictEqual(second.inserted, false);
    assert.strictEqual(table.size, 1);
  });

  it("devuelve un resultado estable/consistente entre replays", () => {
    const table = new FakeShadowLedgerTable();
    const input = makeShadowInput();

    const first = postShadowLedgerMutation(table, input);
    const second = postShadowLedgerMutation(table, input);

    assert.strictEqual(first.entry.idempotency_key, second.entry.idempotency_key);
    assert.strictEqual(first.entry.amount_cents, second.entry.amount_cents);
    assert.strictEqual(first.entry.currency, second.entry.currency);
    assert.strictEqual(first.entry.sync_status, second.entry.sync_status);
    assert.strictEqual(first.entry.sync_status, "pending_qbo_sync");
    // El registro persistido es exactamente el de la primera ejecución.
    assert.strictEqual(table.rows[0].idempotency_key, first.entry.idempotency_key);
  });

  it("la clave es determinística: mismo evento + misma referencia → misma clave", () => {
    const a = buildIdempotencyKey({
      eventType: "balance_captured",
      externalReference: "pi_replay_002",
      orderId: "order_123",
    });
    const b = buildIdempotencyKey({
      eventType: "balance_captured",
      externalReference: "pi_replay_002",
      orderId: "order_123",
    });
    assert.strictEqual(a, b);
  });

  it("eventos distintos (distinta referencia externa) NO colisionan y sí persisten", () => {
    const table = new FakeShadowLedgerTable();

    postShadowLedgerMutation(table, makeShadowInput({ externalReference: "pi_A" }));
    postShadowLedgerMutation(table, makeShadowInput({ externalReference: "pi_B" }));

    assert.strictEqual(table.size, 2);
  });

  it("sin referencia externa, la clave cae al orderId y sigue siendo determinística", () => {
    const table = new FakeShadowLedgerTable();
    const input = makeShadowInput({ externalReference: null, eventType: "capture_failed" });

    const first = postShadowLedgerMutation(table, input);
    const second = postShadowLedgerMutation(table, input);

    assert.strictEqual(first.entry.idempotency_key, "capture_failed:order_123");
    assert.strictEqual(second.inserted, false);
    assert.strictEqual(table.size, 1);
  });
});

describe("INST-FIN-003 · Financial Ledger — double-execution replay", () => {
  it("mismo BusinessEvent → mismo event_id (clave) y contenido determinístico", () => {
    const event = makeBusinessEvent();

    const first = generateJournalEntry(event);
    const second = generateJournalEntry(event);

    assert.strictEqual(first.length, 2);
    assert.strictEqual(second.length, 2);

    // event_id es la clave de idempotencia: idéntica en ambos replays y en todas las filas.
    assert.deepStrictEqual(
      first.map((r) => r.event_id),
      second.map((r) => r.event_id),
    );
    assert.strictEqual(first[0].event_id, event.event_id);

    // Montos y hash de contenido son estables entre replays (resultado consistente).
    assert.deepStrictEqual(
      first.map((r) => r.monto),
      second.map((r) => r.monto),
    );
    assert.deepStrictEqual(
      first.map((r) => r.hash_sha256),
      second.map((r) => r.hash_sha256),
    );
  });

  it("republicar el mismo evento en la frontera fake no duplica el asiento", () => {
    const table = new FakeFinancialLedgerTable();
    const event = makeBusinessEvent();

    const rows = generateJournalEntry(event);
    const slim = rows.map((r) => ({ event_id: r.event_id, hash_sha256: r.hash_sha256 }));

    const firstInserted = table.insertJournal(slim);
    const secondInserted = table.insertJournal(slim);

    assert.strictEqual(firstInserted, 2);
    assert.strictEqual(secondInserted, 0);
    assert.strictEqual(table.size, 2);
  });

  it("un evento distinto (distinto event_id) sí genera un asiento nuevo (sin dedupe cruzado)", () => {
    const table = new FakeFinancialLedgerTable();

    // event_id es la clave de idempotencia; eventos distintos deben usar ids distintos.
    const rowsA = generateJournalEntry(
      makeBusinessEvent({ event_id: "8f2d3b9e-0000-4000-8000-00000000000a", external_reference: "pi_A" }),
    ).map((r) => ({ event_id: r.event_id, hash_sha256: r.hash_sha256 }));
    const rowsB = generateJournalEntry(
      makeBusinessEvent({ event_id: "8f2d3b9e-0000-4000-8000-00000000000b", external_reference: "pi_B" }),
    ).map((r) => ({ event_id: r.event_id, hash_sha256: r.hash_sha256 }));

    table.insertJournal(rowsA);
    table.insertJournal(rowsB);

    assert.strictEqual(table.size, 4);
  });

  it("los asientos se generan append-only (estado 'confirmado', sin edición in-place)", () => {
    // La generación nunca emite una fila "reversada"/"ajuste" ni muta el evento
    // de entrada: las compensaciones son asientos nuevos (tipificados), no edits.
    const event = makeBusinessEvent();
    const before = { ...event };

    const rows = generateJournalEntry(event);

    for (const row of rows) {
      assert.strictEqual(row.estado, "confirmado");
    }
    assert.deepStrictEqual(event, before);
  });
});
