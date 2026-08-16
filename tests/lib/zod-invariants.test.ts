/**
 * E3 — INST-DATA-001 (Zod en límites HTTP · invariantes monetarios).
 *
 * "Zod en los límites HTTP; prohibido z.any()+cast para objetos sensibles;
 * invariantes cruzadas con superRefine."
 *
 * Hallazgo del barrido (grep `superRefine`, `.refine(`, `z.object(` en
 * src/lib y src/app/api/**):
 *
 *   · NO existe NINGÚN schema de dinero con `.superRefine`/`.refine` que
 *     valide un invariante CRUZADO (ej. `total === subtotal + gst + pst`,
 *     `saldo_pendiente <= total`). Los únicos `.refine(` del repo son de
 *     formato (periodo NETFILE en `src/app/api/admin/tax/netfile/route.ts`,
 *     y formato de export en `src/lib/export-service.ts`) — ninguno monetario.
 *
 *   · Lo que SÍ existe (y se testea aquí) son schemas Zod de dinero con
 *     invariantes monetarios a nivel de campo: centavos enteros (`.int()` /
 *     `.bigint()`), no negativos (`.nonnegative()`), enums estrictos, y SIN
 *     `z.any()` ni `.cast()` para objetos sensibles:
 *
 *       - `FacturaSchema` / `FacturaLineaSchema` / `FacturaTaxDetailSchema`
 *         (src/lib/ar-b2b/invoice.ts) — dinero en `bigint`.
 *       - `BusinessEventSchema` / `JournalEntryRowSchema`
 *         (src/lib/ledger-types.ts) — dinero en centavos `number` entero.
 *
 *   · Los invariantes CRUZADOS se garantizan estructuralmente en funciones
 *     puras (no en Zod): `generateInvoice` calcula total = subtotal+gst+pst,
 *     `applyPayment` clampa saldo_pendiente a [0, total], y
 *     `generateJournalEntry` lanza si SUM(débito) ≠ SUM(crédito). Se cubre
 *     ese punto de enforcement en un bloque aparte, anotado como "no-Zod
 *     (enforcement estructural)".
 *
 * Estos tests usan SOLO schemas ya existentes (nada se inventa aquí).
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  FacturaSchema,
  FacturaLineaSchema,
  FacturaTaxDetailSchema,
  applyPayment,
  generateInvoice,
  type Factura,
} from "../../src/lib/ar-b2b/invoice";
import {
  BusinessEventSchema,
  JournalEntryRowSchema,
  type BusinessEvent,
  type JournalEntryRow,
} from "../../src/lib/ledger-types";

// ---------------------------------------------------------------------------
// Payloads de referencia
// ---------------------------------------------------------------------------

function makeFactura(overrides: Partial<Factura> = {}): Factura {
  return {
    factura_id: "fac_001",
    cliente_id: "cli_001",
    orden_id: "ord_001",
    fecha_emision: "2026-08-06",
    fecha_vencimiento: "2026-09-05",
    subtotal: 10000n,
    gst_cents: 500n,
    pst_cents: 700n,
    total: 11200n,
    saldo_pendiente: 11200n,
    estado: "PENDIENTE",
    lineas: [
      {
        linea_id: "lin_001",
        factura_id: "fac_001",
        descripcion: "Servicio de limpieza",
        cantidad: 1,
        precio_unitario: 10000n,
        total: 10000n,
        tipo: "servicio",
      },
    ],
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
    external_reference: "pi_001",
    occurred_at: "2026-08-06T14:30:00.000Z",
    ...overrides,
  };
}

function makeJournalRow(overrides: Partial<JournalEntryRow> = {}): JournalEntryRow {
  return {
    ledger_id: "11111111-1111-4111-8111-111111111111",
    event_id: "8f2d3b9e-0000-4000-8000-000000000001",
    event_type: "hold_captured",
    timestamp: "2026-08-06T14:30:00.000Z",
    periodo_contable: "2026-08",
    cuenta_debito: "1010",
    cuenta_credito: null,
    monto: 24750,
    moneda: "CAD",
    descripcion: "Captura de hold — cobro efectivo",
    referencia: { order_id: "order_123" },
    estado: "confirmado",
    hash_sha256: "a".repeat(64),
    creado_por: "user_1",
    ...overrides,
  };
}

describe("INST-DATA-001 · FacturaSchema (dinero en centavos bigint)", () => {
  it("acepta un payload válido (total === subtotal + gst + pst, saldo_pendiente === total)", () => {
    const factura = makeFactura();
    const parsed = FacturaSchema.safeParse(factura);

    assert.strictEqual(parsed.success, true);
    if (parsed.success) {
      assert.strictEqual(parsed.data.total, parsed.data.subtotal + parsed.data.gst_cents + parsed.data.pst_cents);
      assert.strictEqual(parsed.data.saldo_pendiente, parsed.data.total);
    }
  });

  it("rechaza valores monetarios no-bigint (number/float)", () => {
    const base = makeFactura();
    assert.strictEqual(FacturaSchema.safeParse({ ...base, subtotal: 100.5 }).success, false);
    assert.strictEqual(FacturaSchema.safeParse({ ...base, gst_cents: 0.5 }).success, false);
    assert.strictEqual(FacturaSchema.safeParse({ ...base, pst_cents: 1.25 }).success, false);
    assert.strictEqual(FacturaSchema.safeParse({ ...base, total: 11200.01 }).success, false);
  });

  it("rechaza montos monetarios negativos", () => {
    assert.strictEqual(FacturaSchema.safeParse(makeFactura({ subtotal: -1n })).success, false);
    assert.strictEqual(FacturaSchema.safeParse(makeFactura({ gst_cents: -500n })).success, false);
    assert.strictEqual(FacturaSchema.safeParse(makeFactura({ total: -1n })).success, false);
    // saldo_pendiente >= 0 es invariante monetario: negativo es inválido.
    assert.strictEqual(FacturaSchema.safeParse(makeFactura({ saldo_pendiente: -1n })).success, false);
  });

  it("rechaza estados de factura fuera del enum", () => {
    assert.strictEqual(
      FacturaSchema.safeParse(makeFactura({ estado: "FANTASMA" as Factura["estado"] })).success,
      false,
    );
  });

  it("rechaza una línea con total monetario roto (negativo)", () => {
    const badLine = {
      ...makeFactura().lineas[0],
      total: -1n,
    };
    assert.strictEqual(
      FacturaSchema.safeParse(makeFactura({ lineas: [badLine] })).success,
      false,
    );
    assert.strictEqual(FacturaLineaSchema.safeParse(badLine).success, false);
  });

  it("FacturaTaxDetailSchema exige centavos bigint no negativos", () => {
    assert.strictEqual(FacturaTaxDetailSchema.safeParse({ subtotal_cents: 10000n, gst_cents: 500n, pst_cents: 700n }).success, true);
    assert.strictEqual(FacturaTaxDetailSchema.safeParse({ subtotal_cents: 10000n, gst_cents: -1n, pst_cents: 700n }).success, false);
  });
});

describe("INST-DATA-001 · BusinessEventSchema (entrada al ledger)", () => {
  it("acepta un evento monetario válido", () => {
    assert.strictEqual(BusinessEventSchema.safeParse(makeBusinessEvent()).success, true);
  });

  it("rechaza amount_cents negativo o no entero (la dirección la da event_type)", () => {
    assert.strictEqual(BusinessEventSchema.safeParse(makeBusinessEvent({ amount_cents: -1 })).success, false);
    assert.strictEqual(BusinessEventSchema.safeParse(makeBusinessEvent({ amount_cents: 100.5 })).success, false);
  });

  it("rechaza event_type y processor fuera de enum (sin z.any + cast)", () => {
    assert.strictEqual(
      BusinessEventSchema.safeParse(makeBusinessEvent({ event_type: "no_existe" as BusinessEvent["event_type"] })).success,
      false,
    );
    assert.strictEqual(
      BusinessEventSchema.safeParse(makeBusinessEvent({ processor: "bitcoin" as BusinessEvent["processor"] })).success,
      false,
    );
  });
});

describe("INST-DATA-001 · JournalEntryRowSchema (salida del ledger)", () => {
  it("acepta una fila de asiento válida", () => {
    assert.strictEqual(JournalEntryRowSchema.safeParse(makeJournalRow()).success, true);
  });

  it("rechaza periodo_contable que no es YYYY-MM", () => {
    assert.strictEqual(JournalEntryRowSchema.safeParse(makeJournalRow({ periodo_contable: "2026/08" })).success, false);
    assert.strictEqual(JournalEntryRowSchema.safeParse(makeJournalRow({ periodo_contable: "agosto" })).success, false);
  });

  it("rechaza hash_sha256 que no tiene exactamente 64 caracteres", () => {
    assert.strictEqual(JournalEntryRowSchema.safeParse(makeJournalRow({ hash_sha256: "corto" })).success, false);
    assert.strictEqual(JournalEntryRowSchema.safeParse(makeJournalRow({ hash_sha256: "z".repeat(63) })).success, false);
    assert.strictEqual(JournalEntryRowSchema.safeParse(makeJournalRow({ hash_sha256: "z".repeat(65) })).success, false);
  });

  it("rechaza moneda distinta de CAD y monto negativo/no entero", () => {
    assert.strictEqual(JournalEntryRowSchema.safeParse(makeJournalRow({ moneda: "USD" as "CAD" })).success, false);
    assert.strictEqual(JournalEntryRowSchema.safeParse(makeJournalRow({ monto: -1 })).success, false);
    assert.strictEqual(JournalEntryRowSchema.safeParse(makeJournalRow({ monto: 0.5 })).success, false);
  });
});

describe("INST-DATA-001 · invariantes cruzadas (enforcement estructural, no-Zod)", () => {
  // NOTA: no existe superRefine de dinero. Estos invariantes cruzados viven en
  // funciones puras, no en Zod — se documentan y se testean igualmente porque
  // son el punto real de enforcement del ejemplo de la regla.

  it("generateInvoice garantiza total === subtotal + gst + pst y saldo_pendiente === total", () => {
    const factura = generateInvoice("ord_001", "cli_001", [
      { descripcion: "Servicio", cantidad: 2, precio_unitario: 5000n, tipo: "servicio" },
    ]);

    assert.strictEqual(factura.total, factura.subtotal + factura.gst_cents + factura.pst_cents);
    assert.strictEqual(factura.saldo_pendiente, factura.total);
    assert.strictEqual(factura.subtotal, 10000n);
    assert.strictEqual(factura.gst_cents, 500n);
    assert.strictEqual(factura.pst_cents, 700n);
    assert.strictEqual(factura.total, 11200n);
  });

  it("applyPayment mantiene saldo_pendiente dentro de [0, total] (nunca > total ni negativo)", () => {
    const factura = makeFactura(); // saldo_pendiente = total = 11200n

    // Pago parcial: 0 < saldo < total.
    const parcial = applyPayment(factura, 200n);
    assert.strictEqual(parcial.saldo_pendiente, 11000n);
    assert.ok(parcial.saldo_pendiente <= parcial.total);

    // Pago total: saldo = 0 → PAGADA.
    const total = applyPayment(factura, factura.total);
    assert.strictEqual(total.saldo_pendiente, 0n);
    assert.strictEqual(total.estado, "PAGADA");

    // Sobre-pago: se clampa a 0, nunca saldo a favor negativo.
    const sobrepago = applyPayment(factura, factura.total + 9999n);
    assert.strictEqual(sobrepago.saldo_pendiente, 0n);
  });
});
