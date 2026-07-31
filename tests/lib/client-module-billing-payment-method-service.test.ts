import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAddPaymentMethodInput,
  addPaymentMethod,
  removePaymentMethod,
  PaymentMethodValidationError,
  type AddPaymentMethodInput,
} from "../../src/lib/client-module/payment-method-service";

function validInput(
  overrides: Partial<AddPaymentMethodInput> = {}
): AddPaymentMethodInput {
  return {
    clientId: "client-1",
    methodType: "etransfer",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateAddPaymentMethodInput
// ---------------------------------------------------------------------------

test("validateAddPaymentMethodInput: happy path (etransfer, no token needed) returns no errors", () => {
  assert.deepEqual(validateAddPaymentMethodInput(validInput()), []);
});

test("validateAddPaymentMethodInput: invalid methodType produces an error", () => {
  const errors = validateAddPaymentMethodInput(
    validInput({ methodType: "bitcoin" as any })
  );
  assert.ok(errors.some((e) => e.includes("methodType")));
});

test("validateAddPaymentMethodInput: missing clientId produces an error", () => {
  const errors = validateAddPaymentMethodInput(validInput({ clientId: "" }));
  assert.ok(errors.some((e) => e.includes("clientId")));
});

test("validateAddPaymentMethodInput: credit_card without providerToken produces an error", () => {
  const errors = validateAddPaymentMethodInput(
    validInput({ methodType: "credit_card" })
  );
  assert.ok(errors.some((e) => e.includes("providerToken")));
});

test("validateAddPaymentMethodInput: pad without providerToken produces an error", () => {
  const errors = validateAddPaymentMethodInput(validInput({ methodType: "pad" }));
  assert.ok(errors.some((e) => e.includes("providerToken")));
});

test("validateAddPaymentMethodInput: credit_card with providerToken is valid", () => {
  const errors = validateAddPaymentMethodInput(
    validInput({ methodType: "credit_card", providerToken: "tok_abc123" })
  );
  assert.equal(errors.length, 0);
});

test("validateAddPaymentMethodInput: cheque/invoice/etransfer never require providerToken", () => {
  assert.deepEqual(validateAddPaymentMethodInput(validInput({ methodType: "cheque" })), []);
  assert.deepEqual(validateAddPaymentMethodInput(validInput({ methodType: "invoice" })), []);
  assert.deepEqual(validateAddPaymentMethodInput(validInput({ methodType: "etransfer" })), []);
});

test("validateAddPaymentMethodInput: lastFour must be exactly 4 digits", () => {
  const errors = validateAddPaymentMethodInput(validInput({ lastFour: "12" }));
  assert.ok(errors.some((e) => e.includes("lastFour")));
});

test("validateAddPaymentMethodInput: lastFour with non-digit characters is invalid", () => {
  const errors = validateAddPaymentMethodInput(validInput({ lastFour: "12ab" }));
  assert.ok(errors.some((e) => e.includes("lastFour")));
});

test("validateAddPaymentMethodInput: lastFour with exactly 4 digits is valid", () => {
  const errors = validateAddPaymentMethodInput(validInput({ lastFour: "4242" }));
  assert.equal(errors.some((e) => e.includes("lastFour")), false);
});

test("validateAddPaymentMethodInput: expiryMonth out of range (0 or 13) produces an error", () => {
  assert.ok(
    validateAddPaymentMethodInput(validInput({ expiryMonth: 0 })).some((e) =>
      e.includes("expiryMonth")
    )
  );
  assert.ok(
    validateAddPaymentMethodInput(validInput({ expiryMonth: 13 })).some((e) =>
      e.includes("expiryMonth")
    )
  );
});

test("validateAddPaymentMethodInput: expiryMonth within 1-12 is valid", () => {
  assert.equal(
    validateAddPaymentMethodInput(validInput({ expiryMonth: 1 })).some((e) =>
      e.includes("expiryMonth")
    ),
    false
  );
  assert.equal(
    validateAddPaymentMethodInput(validInput({ expiryMonth: 12 })).some((e) =>
      e.includes("expiryMonth")
    ),
    false
  );
});

test("validateAddPaymentMethodInput: accumulates ALL errors, not just the first", () => {
  const errors = validateAddPaymentMethodInput({
    clientId: "",
    methodType: "credit_card",
    lastFour: "abc",
    expiryMonth: 99,
  } as AddPaymentMethodInput);
  assert.equal(errors.length >= 4, true);
});

// ---------------------------------------------------------------------------
// addPaymentMethod
// ---------------------------------------------------------------------------

test("addPaymentMethod: throws PaymentMethodValidationError and never touches the DB when input is invalid", async () => {
  let fromCalled = false;
  const fakeClient = {
    from() {
      fromCalled = true;
      throw new Error("should never be called");
    },
  };

  await assert.rejects(
    () => addPaymentMethod(validInput({ methodType: "credit_card" }), fakeClient as any),
    PaymentMethodValidationError
  );
  assert.equal(fromCalled, false);
});

test("addPaymentMethod: isDefault=true first unmarks other active defaults, then inserts", async () => {
  const callOrder: string[] = [];
  let unsetFilters: Record<string, unknown> = {};
  let insertedRow: Record<string, unknown> | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "client_payment_methods");
      return {
        update(row: Record<string, unknown>) {
          callOrder.push("update");
          assert.deepEqual(row, { is_default: false });
          return {
            eq(field: string, value: unknown) {
              unsetFilters[field] = value;
              return {
                eq(field2: string, value2: unknown) {
                  unsetFilters[field2] = value2;
                  return { error: null };
                },
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          callOrder.push("insert");
          insertedRow = row;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "pm-1" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const { paymentMethodId } = await addPaymentMethod(
    validInput({ isDefault: true }),
    fakeClient as any
  );

  assert.equal(paymentMethodId, "pm-1");
  assert.deepEqual(callOrder, ["update", "insert"]);
  assert.equal(unsetFilters.client_id, "client-1");
  assert.equal(unsetFilters.status, "active");
  assert.ok(insertedRow);
  assert.equal((insertedRow as any).is_default, true);
});

test("addPaymentMethod: isDefault=false (or omitted) never calls update to unset defaults", async () => {
  let updateCalled = false;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "client_payment_methods");
      return {
        update() {
          updateCalled = true;
          throw new Error("update should not be called when isDefault is falsy");
        },
        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "pm-2" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const { paymentMethodId } = await addPaymentMethod(validInput(), fakeClient as any);
  assert.equal(paymentMethodId, "pm-2");
  assert.equal(updateCalled, false);
});

// ---------------------------------------------------------------------------
// removePaymentMethod
// ---------------------------------------------------------------------------

test("removePaymentMethod: soft-deletes via UPDATE status='removed', never a DELETE", async () => {
  let updateCalled = false;
  let updatedRow: Record<string, unknown> | null = null;
  let filteredId: string | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "client_payment_methods");
      return {
        update(row: Record<string, unknown>) {
          updateCalled = true;
          updatedRow = row;
          return {
            eq(field: string, value: string) {
              assert.equal(field, "id");
              filteredId = value;
              return { error: null };
            },
          };
        },
        delete() {
          throw new Error("delete() should never be called -- soft-delete only");
        },
      };
    },
  };

  await removePaymentMethod("pm-1", fakeClient as any);
  assert.equal(updateCalled, true);
  assert.deepEqual(updatedRow, { status: "removed" });
  assert.equal(filteredId, "pm-1");
});
