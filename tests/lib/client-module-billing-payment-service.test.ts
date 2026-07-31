import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordPayment,
  PaymentRecordingError,
} from "../../src/lib/client-module/payment-service";

// ---------------------------------------------------------------------------
// recordPayment
// ---------------------------------------------------------------------------

test("recordPayment: happy path calls the RPC and returns the relevant fields", async () => {
  let rpcName: string | null = null;
  let rpcArgs: Record<string, unknown> | null = null;

  const fakeClient = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return {
        data: {
          id: "payment-1",
          status: "completed",
          invoice_status: "paid",
          balance_due_cents: 0,
        },
        error: null,
      };
    },
  };

  const result = await recordPayment({
    invoiceId: "invoice-1",
    clientId: "client-1",
    paymentMethodId: "pm-1",
    amountCents: 5000,
    providerReference: "ch_abc123",
    client: fakeClient as any,
  });

  assert.equal(rpcName, "record_client_payment");
  assert.deepEqual(rpcArgs, {
    p_invoice_id: "invoice-1",
    p_client_id: "client-1",
    p_payment_method_id: "pm-1",
    p_amount_cents: 5000,
    p_provider_reference: "ch_abc123",
  });
  assert.deepEqual(result, {
    paymentId: "payment-1",
    invoiceStatus: "paid",
    balanceDueCents: 0,
  });
});

test("recordPayment: supports the RPC returning an array with one row", async () => {
  const fakeClient = {
    async rpc() {
      return {
        data: [
          {
            id: "payment-2",
            status: "completed",
            invoice_status: "partially_paid",
            balance_due_cents: 2500,
          },
        ],
        error: null,
      };
    },
  };

  const result = await recordPayment({
    invoiceId: "invoice-2",
    clientId: "client-2",
    paymentMethodId: null,
    amountCents: 2500,
    client: fakeClient as any,
  });

  assert.equal(result.paymentId, "payment-2");
  assert.equal(result.invoiceStatus, "partially_paid");
  assert.equal(result.balanceDueCents, 2500);
});

test("recordPayment: amountCents <= 0 throws PaymentRecordingError without calling .rpc()", async () => {
  let rpcCalled = false;
  const fakeClient = {
    async rpc() {
      rpcCalled = true;
      throw new Error("rpc should never be called");
    },
  };

  await assert.rejects(
    () =>
      recordPayment({
        invoiceId: "invoice-1",
        clientId: "client-1",
        paymentMethodId: null,
        amountCents: 0,
        client: fakeClient as any,
      }),
    PaymentRecordingError
  );
  assert.equal(rpcCalled, false);
});

test("recordPayment: negative amountCents also throws before calling .rpc()", async () => {
  let rpcCalled = false;
  const fakeClient = {
    async rpc() {
      rpcCalled = true;
      throw new Error("rpc should never be called");
    },
  };

  await assert.rejects(
    () =>
      recordPayment({
        invoiceId: "invoice-1",
        clientId: "client-1",
        paymentMethodId: null,
        amountCents: -100,
        client: fakeClient as any,
      }),
    PaymentRecordingError
  );
  assert.equal(rpcCalled, false);
});

test("recordPayment: propagates a PaymentRecordingError when the RPC returns an error", async () => {
  const fakeClient = {
    async rpc() {
      return { data: null, error: { message: "invoice not found" } };
    },
  };

  await assert.rejects(
    () =>
      recordPayment({
        invoiceId: "invoice-missing",
        clientId: "client-1",
        paymentMethodId: null,
        amountCents: 1000,
        client: fakeClient as any,
      }),
    PaymentRecordingError
  );
});

test("recordPayment: paymentMethodId can be null (e.g. cheque/etransfer payments)", async () => {
  let rpcArgs: Record<string, unknown> | null = null;
  const fakeClient = {
    async rpc(_name: string, args: Record<string, unknown>) {
      rpcArgs = args;
      return {
        data: { id: "payment-3", status: "completed", invoice_status: "paid", balance_due_cents: 0 },
        error: null,
      };
    },
  };

  await recordPayment({
    invoiceId: "invoice-3",
    clientId: "client-3",
    paymentMethodId: null,
    amountCents: 1000,
    client: fakeClient as any,
  });

  assert.equal((rpcArgs as any).p_payment_method_id, null);
});
