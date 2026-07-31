import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCreateClientInput,
  createClient,
  updateClientStatus,
  ClientCreationValidationError,
  type CreateClientInput,
} from "../../src/lib/client-module/client-service";
import { InvalidStatusTransitionError } from "../../src/lib/client-module/client-lifecycle";

function validInput(overrides: Partial<CreateClientInput> = {}): CreateClientInput {
  return {
    clientType: "residential",
    legalName: "Jane Doe",
    displayName: "Jane",
    email: "jane.doe@example.com",
    phonePrimary: "604-555-0123",
    preferredLanguage: "en",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateCreateClientInput
// ---------------------------------------------------------------------------

test("validateCreateClientInput: happy path returns no errors", () => {
  assert.deepEqual(validateCreateClientInput(validInput()), []);
});

test("validateCreateClientInput: invalid clientType produces an error", () => {
  const errors = validateCreateClientInput(
    validInput({ clientType: "not-a-type" as any })
  );
  assert.ok(errors.some((e) => e.field === "clientType"));
});

test("validateCreateClientInput: empty legalName produces an error", () => {
  const errors = validateCreateClientInput(validInput({ legalName: "" }));
  assert.ok(errors.some((e) => e.field === "legalName"));
});

test("validateCreateClientInput: invalid email produces an error", () => {
  const errors = validateCreateClientInput(validInput({ email: "not-an-email" }));
  assert.ok(errors.some((e) => e.field === "email"));
});

test("validateCreateClientInput: invalid phonePrimary produces an error", () => {
  const errors = validateCreateClientInput(validInput({ phonePrimary: "123" }));
  assert.ok(errors.some((e) => e.field === "phonePrimary"));
});

test("validateCreateClientInput: invalid phoneSecondary (when provided) produces an error", () => {
  const errors = validateCreateClientInput(
    validInput({ phoneSecondary: "not-a-phone" })
  );
  assert.ok(errors.some((e) => e.field === "phoneSecondary"));
});

test("validateCreateClientInput: omitted phoneSecondary is fine (optional field)", () => {
  const errors = validateCreateClientInput(validInput());
  assert.equal(errors.some((e) => e.field === "phoneSecondary"), false);
});

test("validateCreateClientInput: invalid preferredLanguage produces an error", () => {
  const errors = validateCreateClientInput(
    validInput({ preferredLanguage: "de" as any })
  );
  assert.ok(errors.some((e) => e.field === "preferredLanguage"));
});

test("validateCreateClientInput: accumulates ALL errors, not just the first", () => {
  const errors = validateCreateClientInput({
    clientType: "bogus" as any,
    legalName: "",
    email: "not-an-email",
    phonePrimary: "123",
  } as CreateClientInput);
  const fields = errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ["clientType", "email", "legalName", "phonePrimary"]);
});

// ---------------------------------------------------------------------------
// createClient
// ---------------------------------------------------------------------------

test("createClient: throws ClientCreationValidationError and never touches the DB when input is invalid", async () => {
  let fromCalled = false;
  const fakeClient = {
    from() {
      fromCalled = true;
      throw new Error("should never be called");
    },
  };

  await assert.rejects(
    () => createClient(validInput({ email: "bad" }), fakeClient as any),
    ClientCreationValidationError
  );
  assert.equal(fromCalled, false);
});

test("createClient: always inserts with status 'lead', regardless of input", async () => {
  let insertedRow: Record<string, unknown> | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "clients");
      return {
        insert(row: Record<string, unknown>) {
          insertedRow = row;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "client-abc-123" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const { clientId } = await createClient(validInput(), fakeClient as any);

  assert.equal(clientId, "client-abc-123");
  assert.ok(insertedRow);
  assert.equal((insertedRow as any).status, "lead");
  assert.equal((insertedRow as any).client_type, "residential");
  assert.equal((insertedRow as any).email, "jane.doe@example.com");
});

// ---------------------------------------------------------------------------
// updateClientStatus
// ---------------------------------------------------------------------------

test("updateClientStatus: valid transition reads current status then updates", async () => {
  let updateCalled = false;
  let updatedTo: string | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "clients");
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  return { data: { status: "lead" }, error: null };
                },
              };
            },
          };
        },
        update(row: Record<string, unknown>) {
          updateCalled = true;
          updatedTo = row.status as string;
          return {
            eq() {
              return { error: null };
            },
          };
        },
      };
    },
  };

  await updateClientStatus("client-1", "onboarding", fakeClient as any);
  assert.equal(updateCalled, true);
  assert.equal(updatedTo, "onboarding");
});

test("updateClientStatus: invalid transition throws InvalidStatusTransitionError and never reaches UPDATE", async () => {
  let updateCalled = false;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "clients");
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  return { data: { status: "churned" }, error: null };
                },
              };
            },
          };
        },
        update() {
          updateCalled = true;
          throw new Error("update should never be called for an invalid transition");
        },
      };
    },
  };

  await assert.rejects(
    () => updateClientStatus("client-2", "active", fakeClient as any),
    InvalidStatusTransitionError
  );
  assert.equal(updateCalled, false);
});
