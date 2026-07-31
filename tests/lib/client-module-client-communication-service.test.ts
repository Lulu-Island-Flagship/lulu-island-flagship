import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateQueueCommunicationInput,
  queueCommunication,
  markCommunicationSent,
  markCommunicationFailed,
  listClientCommunications,
  CommunicationValidationError,
  type QueueCommunicationInput,
} from "../../src/lib/client-module/client-communication-service";

// ---------------------------------------------------------------------------
// validateQueueCommunicationInput
// ---------------------------------------------------------------------------

function baseInput(
  overrides: Partial<QueueCommunicationInput> = {}
): QueueCommunicationInput {
  return {
    clientId: "client-1",
    channel: "sms",
    communicationType: "appointment_confirmation",
    ...overrides,
  };
}

test("validateQueueCommunicationInput: sms without subject is valid", () => {
  const errors = validateQueueCommunicationInput(baseInput({ channel: "sms" }));
  assert.deepEqual(errors, []);
});

test("validateQueueCommunicationInput: email without subject and without templateKey is invalid", () => {
  const errors = validateQueueCommunicationInput(
    baseInput({ channel: "email", communicationType: "invoice_sent" })
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requires either subject or templateKey/);
});

test("validateQueueCommunicationInput: email with subject is valid", () => {
  const errors = validateQueueCommunicationInput(
    baseInput({
      channel: "email",
      communicationType: "invoice_sent",
      subject: "Your invoice is ready",
    })
  );
  assert.deepEqual(errors, []);
});

test("validateQueueCommunicationInput: email with only templateKey is valid", () => {
  const errors = validateQueueCommunicationInput(
    baseInput({
      channel: "email",
      communicationType: "invoice_sent",
      templateKey: "invoice_sent_v1",
    })
  );
  assert.deepEqual(errors, []);
});

test("validateQueueCommunicationInput: accumulates multiple errors (clientId + channel + communicationType)", () => {
  const errors = validateQueueCommunicationInput({
    clientId: "",
    channel: "fax" as any,
    communicationType: "not_a_type" as any,
  });
  assert.equal(errors.length, 3);
});

// ---------------------------------------------------------------------------
// queueCommunication
// ---------------------------------------------------------------------------

test("queueCommunication: validates before inserting and rejects invalid input without touching the client", async () => {
  let fromCalled = false;
  const fakeClient = {
    from() {
      fromCalled = true;
      throw new Error("insert should never be reached when validation fails");
    },
  };

  await assert.rejects(
    () =>
      queueCommunication(
        baseInput({ channel: "email", communicationType: "invoice_sent" }),
        fakeClient as any
      ),
    CommunicationValidationError
  );
  assert.equal(fromCalled, false);
});

test("queueCommunication: always inserts with status='queued'", async () => {
  let insertedRow: Record<string, unknown> | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "client_communications");
      return {
        insert(row: Record<string, unknown>) {
          insertedRow = row;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "comm-1" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const { communicationId } = await queueCommunication(
    baseInput({
      channel: "email",
      communicationType: "invoice_sent",
      subject: "Your invoice",
      relatedInvoiceId: "invoice-1",
    }),
    fakeClient as any
  );

  assert.equal(communicationId, "comm-1");
  assert.ok(insertedRow);
  assert.equal((insertedRow as any).status, "queued");
  assert.equal((insertedRow as any).client_id, "client-1");
  assert.equal((insertedRow as any).channel, "email");
  assert.equal((insertedRow as any).communication_type, "invoice_sent");
  assert.equal((insertedRow as any).subject, "Your invoice");
  assert.equal((insertedRow as any).related_invoice_id, "invoice-1");
  assert.equal((insertedRow as any).template_key, null);
});

test("queueCommunication: throws when insert fails", async () => {
  const fakeClient = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                async single() {
                  return { data: null, error: { message: "db error" } };
                },
              };
            },
          };
        },
      };
    },
  };

  await assert.rejects(() =>
    queueCommunication(baseInput(), fakeClient as any)
  );
});

// ---------------------------------------------------------------------------
// markCommunicationSent / markCommunicationFailed
// ---------------------------------------------------------------------------

test("markCommunicationSent: updates status='sent' and sets sent_at, filtered by id", async () => {
  let updatedRow: Record<string, unknown> | null = null;
  let filteredId: string | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "client_communications");
      return {
        update(row: Record<string, unknown>) {
          updatedRow = row;
          return {
            eq(column: string, value: string) {
              assert.equal(column, "id");
              filteredId = value;
              return { error: null };
            },
          };
        },
      };
    },
  };

  await markCommunicationSent("comm-1", fakeClient as any);

  assert.equal(filteredId, "comm-1");
  assert.ok(updatedRow);
  assert.equal((updatedRow as any).status, "sent");
  assert.ok(typeof (updatedRow as any).sent_at === "string");
});

test("markCommunicationSent: throws when update fails", async () => {
  const fakeClient = {
    from() {
      return {
        update() {
          return {
            eq() {
              return { error: { message: "db error" } };
            },
          };
        },
      };
    },
  };

  await assert.rejects(() => markCommunicationSent("comm-1", fakeClient as any));
});

test("markCommunicationFailed: updates status='failed', filtered by id", async () => {
  let updatedRow: Record<string, unknown> | null = null;
  let filteredId: string | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "client_communications");
      return {
        update(row: Record<string, unknown>) {
          updatedRow = row;
          return {
            eq(column: string, value: string) {
              assert.equal(column, "id");
              filteredId = value;
              return { error: null };
            },
          };
        },
      };
    },
  };

  await markCommunicationFailed("comm-2", fakeClient as any);

  assert.equal(filteredId, "comm-2");
  assert.ok(updatedRow);
  assert.equal((updatedRow as any).status, "failed");
  assert.equal((updatedRow as any).sent_at, undefined);
});

// ---------------------------------------------------------------------------
// listClientCommunications
// ---------------------------------------------------------------------------

test("listClientCommunications: orders by created_at descending and maps rows to camelCase", async () => {
  let filteredClientId: string | null = null;
  let orderColumn: string | null = null;
  let orderOptions: Record<string, unknown> | null = null;

  const rows = [
    {
      id: "comm-2",
      client_id: "client-1",
      channel: "email",
      communication_type: "payment_receipt",
      template_key: "receipt_v1",
      subject: "Receipt",
      status: "sent",
      sent_at: "2026-07-30T00:00:00.000Z",
      related_invoice_id: "invoice-9",
      created_at: "2026-07-30T00:00:00.000Z",
    },
    {
      id: "comm-1",
      client_id: "client-1",
      channel: "sms",
      communication_type: "appointment_reminder",
      template_key: null,
      subject: null,
      status: "queued",
      sent_at: null,
      related_invoice_id: null,
      created_at: "2026-07-29T00:00:00.000Z",
    },
  ];

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "client_communications");
      return {
        select(columns: string) {
          assert.equal(columns, "*");
          return {
            eq(column: string, value: string) {
              assert.equal(column, "client_id");
              filteredClientId = value;
              return {
                order(column: string, options: Record<string, unknown>) {
                  orderColumn = column;
                  orderOptions = options;
                  return { data: rows, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const result = await listClientCommunications("client-1", fakeClient as any);

  assert.equal(filteredClientId, "client-1");
  assert.equal(orderColumn, "created_at");
  assert.deepEqual(orderOptions, { ascending: false });
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "comm-2");
  assert.equal(result[0].communicationType, "payment_receipt");
  assert.equal(result[0].relatedInvoiceId, "invoice-9");
  assert.equal(result[1].id, "comm-1");
  assert.equal(result[1].templateKey, null);
  assert.equal(result[1].subject, null);
});

test("listClientCommunications: throws when query fails", async () => {
  const fakeClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                order() {
                  return { data: null, error: { message: "db error" } };
                },
              };
            },
          };
        },
      };
    },
  };

  await assert.rejects(() =>
    listClientCommunications("client-1", fakeClient as any)
  );
});
