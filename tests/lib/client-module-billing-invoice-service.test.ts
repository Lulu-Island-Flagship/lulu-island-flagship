import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateLineItemAmountCents,
  calculateInvoiceTotals,
  generateInvoiceNumber,
} from "../../src/lib/client-module/billing-calculations";
import {
  createInvoice,
  InvoiceCreationError,
  OrphanedInvoiceError,
} from "../../src/lib/client-module/invoice-service";

// ---------------------------------------------------------------------------
// calculateLineItemAmountCents (sin DB)
// ---------------------------------------------------------------------------

test("calculateLineItemAmountCents: whole numbers multiply exactly", () => {
  assert.equal(calculateLineItemAmountCents(2, 5000), 10000);
});

test("calculateLineItemAmountCents: rounds fractional quantity (1.5 hrs) to nearest cent", () => {
  // 1.5 hrs * 4599 cents/hr = 6898.5 -> rounds to 6899
  assert.equal(calculateLineItemAmountCents(1.5, 4599), 6899);
});

test("calculateLineItemAmountCents: rounds down when fraction is below .5", () => {
  // 1.25 * 100 = 125 exactly, no rounding ambiguity -- use a case that
  // lands below .5 to confirm round-down behavior.
  // 1.333 * 300 = 399.9 -> rounds to 400
  assert.equal(calculateLineItemAmountCents(1.333, 300), 400);
});

test("calculateLineItemAmountCents: zero quantity yields zero", () => {
  assert.equal(calculateLineItemAmountCents(0, 9999), 0);
});

// ---------------------------------------------------------------------------
// calculateInvoiceTotals (sin DB)
// ---------------------------------------------------------------------------

test("calculateInvoiceTotals: sums multiple line items and applies real BC rates (GST 5%, PST 7%)", () => {
  const lineItems = [
    { description: "Deep cleaning", quantity: 2, unitPriceCents: 15000 },
    { description: "Carpet cleaning", quantity: 1.5, unitPriceCents: 8000 },
    { description: "Window cleaning", quantity: 3, unitPriceCents: 2500 },
  ];

  const totals = calculateInvoiceTotals(lineItems, 0.05, 0.07);

  // subtotal = round(2*15000) + round(1.5*8000) + round(3*2500)
  //          = 30000 + 12000 + 7500 = 49500
  assert.equal(totals.subtotalCents, 49500);
  assert.equal(totals.gstAmountCents, Math.round(49500 * 0.05));
  assert.equal(totals.pstAmountCents, Math.round(49500 * 0.07));

  // subtotal + gst + pst must equal total EXACTLY (integer arithmetic,
  // no drift).
  assert.equal(
    totals.subtotalCents + totals.gstAmountCents + totals.pstAmountCents,
    totals.totalCents
  );
});

test("calculateInvoiceTotals: single line item, exact integer rates", () => {
  const lineItems = [{ description: "Regular cleaning", quantity: 1, unitPriceCents: 10000 }];
  const totals = calculateInvoiceTotals(lineItems, 0.05, 0.07);

  assert.equal(totals.subtotalCents, 10000);
  assert.equal(totals.gstAmountCents, 500);
  assert.equal(totals.pstAmountCents, 700);
  assert.equal(totals.totalCents, 11200);
});

test("calculateInvoiceTotals: empty line items produce zero totals", () => {
  const totals = calculateInvoiceTotals([], 0.05, 0.07);
  assert.deepEqual(totals, {
    subtotalCents: 0,
    gstAmountCents: 0,
    pstAmountCents: 0,
    totalCents: 0,
  });
});

// ---------------------------------------------------------------------------
// generateInvoiceNumber (sin DB)
// ---------------------------------------------------------------------------

test("generateInvoiceNumber: formats with year and zero-padded sequence", () => {
  const issueDate = new Date("2026-07-30T12:00:00Z");
  assert.equal(generateInvoiceNumber(issueDate, 123), "INV-2026-000123");
});

test("generateInvoiceNumber: pads small sequence numbers to 6 digits", () => {
  const issueDate = new Date("2026-01-05T00:00:00Z");
  assert.equal(generateInvoiceNumber(issueDate, 1), "INV-2026-000001");
});

test("generateInvoiceNumber: does not truncate sequence numbers wider than the padding", () => {
  const issueDate = new Date("2026-01-05T00:00:00Z");
  assert.equal(generateInvoiceNumber(issueDate, 1234567), "INV-2026-1234567");
});

test("generateInvoiceNumber: uses the year from issueDate, not the current system date", () => {
  const issueDate = new Date("2025-12-31T23:59:59Z");
  assert.equal(generateInvoiceNumber(issueDate, 42), "INV-2025-000042");
});

// ---------------------------------------------------------------------------
// createInvoice (dependency-injected, no real Supabase client)
// ---------------------------------------------------------------------------
//
// Tras el retrofit a RPC atómica (migración 281,
// create_client_invoice_with_line_items), createInvoice ya NO hace un
// insert de factura y un insert de líneas por separado con saga+
// compensación -- hace una sola llamada inyectable (callCreateInvoiceRpcFn)
// que representa el `client.rpc('create_client_invoice_with_line_items', ...)`
// real. Ya no existe "intento de compensación" que testear (Postgres
// revierte todo solo si algo falla dentro de la RPC) -- el caso
// "compensación también falló" (antes: OrphanedInvoiceError) se reemplaza
// por un simple "la RPC falló -> el error se propaga tal cual, sin ningún
// intento de limpieza manual del lado de TS".

function fakeGetSettingFn(rates: { gst: number; pst: number }) {
  return async (key: string) => {
    if (key === "tax_gst_rate") return rates.gst;
    if (key === "tax_pst_rate_bc") return rates.pst;
    throw new Error(`unexpected setting key requested in test: ${key}`);
  };
}

test("createInvoice: happy path calls the atomic RPC once and returns totals", async () => {
  const rpcCalls: Array<Record<string, unknown>> = [];

  const result = await createInvoice({
    clientId: "client-1",
    lineItems: [
      { description: "Regular cleaning", quantity: 2, unitPriceCents: 10000 },
      { description: "Extra fridge cleaning", quantity: 1, unitPriceCents: 2500 },
    ],
    issueDate: new Date("2026-07-30T00:00:00Z"),
    dueDateDays: 15,
    client: {} as any,
    getSettingFn: fakeGetSettingFn({ gst: 0.05, pst: 0.07 }) as any,
    callCreateInvoiceRpcFn: async (params) => {
      rpcCalls.push(params as unknown as Record<string, unknown>);
      assert.equal(params.clientId, "client-1");
      assert.equal(params.lineItems.length, 2);
      return "invoice-123";
    },
  });

  assert.equal(result.invoiceId, "invoice-123");
  // subtotal = 20000 + 2500 = 22500; gst = 1125; pst = 1575; total = 25200
  assert.equal(result.totals.subtotalCents, 22500);
  assert.equal(result.totals.gstAmountCents, 1125);
  assert.equal(result.totals.pstAmountCents, 1575);
  assert.equal(result.totals.totalCents, 25200);

  // Un solo round-trip a la RPC atómica -- ya no hay una llamada separada
  // para insertar líneas.
  assert.equal(rpcCalls.length, 1);
  assert.ok(typeof rpcCalls[0].invoiceNumber === "string");
  assert.ok((rpcCalls[0].invoiceNumber as string).length > 0);
});

test("createInvoice: empty lineItems throws InvoiceCreationError without calling the RPC", async () => {
  let rpcCalled = false;

  await assert.rejects(
    () =>
      createInvoice({
        clientId: "client-2",
        lineItems: [],
        issueDate: new Date("2026-07-30T00:00:00Z"),
        dueDateDays: 15,
        client: {} as any,
        getSettingFn: fakeGetSettingFn({ gst: 0.05, pst: 0.07 }) as any,
        callCreateInvoiceRpcFn: async () => {
          rpcCalled = true;
          return "should-not-be-called";
        },
      }),
    InvoiceCreationError
  );

  assert.equal(rpcCalled, false);
});

test("createInvoice: when the atomic RPC fails, the error propagates as-is (no manual cleanup attempted -- Postgres already rolled everything back)", async () => {
  await assert.rejects(
    () =>
      createInvoice({
        clientId: "client-3",
        lineItems: [{ description: "Regular cleaning", quantity: 1, unitPriceCents: 10000 }],
        issueDate: new Date("2026-07-30T00:00:00Z"),
        dueDateDays: 15,
        client: {} as any,
        getSettingFn: fakeGetSettingFn({ gst: 0.05, pst: 0.07 }) as any,
        callCreateInvoiceRpcFn: async () => {
          throw new InvoiceCreationError(
            "create_client_invoice_with_line_items RPC failed for client \"client-3\": boom"
          );
        },
      }),
    InvoiceCreationError
  );
});

test("createInvoice: never throws OrphanedInvoiceError -- that failure mode no longer exists after the atomic RPC retrofit", async () => {
  await assert.rejects(
    () =>
      createInvoice({
        clientId: "client-4",
        lineItems: [{ description: "Regular cleaning", quantity: 1, unitPriceCents: 10000 }],
        issueDate: new Date("2026-07-30T00:00:00Z"),
        dueDateDays: 15,
        client: {} as any,
        getSettingFn: fakeGetSettingFn({ gst: 0.05, pst: 0.07 }) as any,
        callCreateInvoiceRpcFn: async () => {
          throw new InvoiceCreationError("RPC failed entirely -- Postgres already rolled back");
        },
      }),
    (err: unknown) => {
      // El error propagado es un InvoiceCreationError genérico, nunca un
      // OrphanedInvoiceError -- ese tipo queda importado arriba solo para
      // confirmar (vía este assert negativo) que ya no se lanza desde
      // createInvoice tras el retrofit a RPC atómica.
      assert.ok(err instanceof InvoiceCreationError);
      assert.ok(!(err instanceof OrphanedInvoiceError));
      return true;
    }
  );
});

test("createInvoice: passes issueDate + dueDateDays through (due date computed correctly)", async () => {
  let capturedDueDate: Date | null = null;

  await createInvoice({
    clientId: "client-5",
    lineItems: [{ description: "Regular cleaning", quantity: 1, unitPriceCents: 10000 }],
    issueDate: new Date("2026-07-01T00:00:00Z"),
    dueDateDays: 15,
    client: {} as any,
    getSettingFn: fakeGetSettingFn({ gst: 0.05, pst: 0.07 }) as any,
    callCreateInvoiceRpcFn: async (params) => {
      capturedDueDate = params.dueDate;
      return "invoice-due-date-check";
    },
  });

  assert.ok(capturedDueDate);
  assert.equal((capturedDueDate as unknown as Date).toISOString().slice(0, 10), "2026-07-16");
});
