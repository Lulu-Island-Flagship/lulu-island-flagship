import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePropertyInput,
  createProperty,
  validatePropertyServiceInput,
  addPropertyService,
  PropertyValidationErrorSet,
  PropertyServiceValidationErrorSet,
  type CreatePropertyInput,
  type AddPropertyServiceInput,
} from "../../src/lib/client-module/property-service";

function validPropertyInput(
  overrides: Partial<CreatePropertyInput> = {}
): CreatePropertyInput {
  return {
    propertyType: "house",
    addressLine1: "123 Test Ave",
    city: "Victoria",
    province: "BC",
    postalCode: "V8W 1A1",
    sqFt: 1500,
    bathrooms: 2,
    ...overrides,
  };
}

function validServiceInput(
  overrides: Partial<AddPropertyServiceInput> = {}
): AddPropertyServiceInput {
  return {
    serviceType: "regular_cleaning",
    frequency: "biweekly",
    rateType: "flat_fee",
    rateAmountCents: 12000,
    startDate: "2026-08-01",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validatePropertyInput
// ---------------------------------------------------------------------------

test("validatePropertyInput: happy path returns no errors", () => {
  assert.deepEqual(validatePropertyInput(validPropertyInput()), []);
});

test("validatePropertyInput: invalid propertyType produces an error", () => {
  const errors = validatePropertyInput(
    validPropertyInput({ propertyType: "castle" as any })
  );
  assert.ok(errors.some((e) => e.field === "propertyType"));
});

test("validatePropertyInput: empty addressLine1 produces an error", () => {
  const errors = validatePropertyInput(validPropertyInput({ addressLine1: "" }));
  assert.ok(errors.some((e) => e.field === "addressLine1"));
});

test("validatePropertyInput: empty city produces an error", () => {
  const errors = validatePropertyInput(validPropertyInput({ city: "" }));
  assert.ok(errors.some((e) => e.field === "city"));
});

test("validatePropertyInput: invalid postalCode format produces an error", () => {
  const errors = validatePropertyInput(validPropertyInput({ postalCode: "12345" }));
  assert.ok(errors.some((e) => e.field === "postalCode"));
});

test("validatePropertyInput: sqFt <= 0 produces an error", () => {
  const errors = validatePropertyInput(validPropertyInput({ sqFt: 0 }));
  assert.ok(errors.some((e) => e.field === "sqFt"));
});

test("validatePropertyInput: sqFt omitted is fine", () => {
  const errors = validatePropertyInput(validPropertyInput({ sqFt: undefined }));
  assert.equal(errors.some((e) => e.field === "sqFt"), false);
});

test("validatePropertyInput: negative bathrooms produces an error", () => {
  const errors = validatePropertyInput(validPropertyInput({ bathrooms: -1 }));
  assert.ok(errors.some((e) => e.field === "bathrooms"));
});

test("validatePropertyInput: bathrooms of 0 is valid (no bathroom count edge case)", () => {
  const errors = validatePropertyInput(validPropertyInput({ bathrooms: 0 }));
  assert.equal(errors.some((e) => e.field === "bathrooms"), false);
});

test("validatePropertyInput: accumulates ALL errors", () => {
  const errors = validatePropertyInput({
    propertyType: "bogus" as any,
    addressLine1: "",
    city: "",
    province: "BC",
    postalCode: "bad",
  } as CreatePropertyInput);
  const fields = errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ["addressLine1", "city", "postalCode", "propertyType"]);
});

// ---------------------------------------------------------------------------
// createProperty
// ---------------------------------------------------------------------------

test("createProperty: throws PropertyValidationErrorSet and never touches the DB when invalid", async () => {
  let fromCalled = false;
  const fakeClient = {
    from() {
      fromCalled = true;
      throw new Error("should never be called");
    },
  };

  await assert.rejects(
    () =>
      createProperty("client-1", validPropertyInput({ postalCode: "bad" }), fakeClient as any),
    PropertyValidationErrorSet
  );
  assert.equal(fromCalled, false);
});

test("createProperty: on success inserts with the given clientId and returns propertyId", async () => {
  let insertedRow: Record<string, unknown> | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "client_module_properties");
      return {
        insert(row: Record<string, unknown>) {
          insertedRow = row;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "prop-123" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const { propertyId } = await createProperty(
    "client-42",
    validPropertyInput(),
    fakeClient as any
  );

  assert.equal(propertyId, "prop-123");
  assert.ok(insertedRow);
  assert.equal((insertedRow as any).client_id, "client-42");
  assert.equal((insertedRow as any).postal_code, "V8W 1A1");
});

// ---------------------------------------------------------------------------
// validatePropertyServiceInput
// ---------------------------------------------------------------------------

test("validatePropertyServiceInput: happy path returns no errors", () => {
  assert.deepEqual(validatePropertyServiceInput(validServiceInput()), []);
});

test("validatePropertyServiceInput: invalid serviceType produces an error", () => {
  const errors = validatePropertyServiceInput(
    validServiceInput({ serviceType: "bogus" as any })
  );
  assert.ok(errors.some((e) => e.field === "serviceType"));
});

test("validatePropertyServiceInput: invalid frequency produces an error", () => {
  const errors = validatePropertyServiceInput(
    validServiceInput({ frequency: "bogus" as any })
  );
  assert.ok(errors.some((e) => e.field === "frequency"));
});

test("validatePropertyServiceInput: invalid rateType produces an error", () => {
  const errors = validatePropertyServiceInput(
    validServiceInput({ rateType: "bogus" as any })
  );
  assert.ok(errors.some((e) => e.field === "rateType"));
});

test("validatePropertyServiceInput: estimatedDurationHours <= 0 produces an error", () => {
  const errors = validatePropertyServiceInput(
    validServiceInput({ estimatedDurationHours: 0 })
  );
  assert.ok(errors.some((e) => e.field === "estimatedDurationHours"));
});

test("validatePropertyServiceInput: estimatedDurationHours omitted is fine", () => {
  const errors = validatePropertyServiceInput(validServiceInput());
  assert.equal(errors.some((e) => e.field === "estimatedDurationHours"), false);
});

test("validatePropertyServiceInput: negative rateAmountCents produces an error", () => {
  const errors = validatePropertyServiceInput(
    validServiceInput({ rateAmountCents: -1 })
  );
  assert.ok(errors.some((e) => e.field === "rateAmountCents"));
});

test("validatePropertyServiceInput: rateAmountCents of 0 is valid", () => {
  const errors = validatePropertyServiceInput(
    validServiceInput({ rateAmountCents: 0 })
  );
  assert.equal(errors.some((e) => e.field === "rateAmountCents"), false);
});

test("validatePropertyServiceInput: missing startDate produces an error", () => {
  const errors = validatePropertyServiceInput(validServiceInput({ startDate: "" }));
  assert.ok(errors.some((e) => e.field === "startDate"));
});

test("validatePropertyServiceInput: endDate before startDate produces an error", () => {
  const errors = validatePropertyServiceInput(
    validServiceInput({ startDate: "2026-08-10", endDate: "2026-08-01" })
  );
  assert.ok(errors.some((e) => e.field === "endDate"));
});

test("validatePropertyServiceInput: endDate equal to startDate is valid", () => {
  const errors = validatePropertyServiceInput(
    validServiceInput({ startDate: "2026-08-10", endDate: "2026-08-10" })
  );
  assert.equal(errors.some((e) => e.field === "endDate"), false);
});

test("validatePropertyServiceInput: endDate after startDate is valid", () => {
  const errors = validatePropertyServiceInput(
    validServiceInput({ startDate: "2026-08-10", endDate: "2026-09-01" })
  );
  assert.equal(errors.some((e) => e.field === "endDate"), false);
});

// ---------------------------------------------------------------------------
// addPropertyService
// ---------------------------------------------------------------------------

test("addPropertyService: throws PropertyServiceValidationErrorSet and never touches the DB when invalid", async () => {
  let fromCalled = false;
  const fakeClient = {
    from() {
      fromCalled = true;
      throw new Error("should never be called");
    },
  };

  await assert.rejects(
    () =>
      addPropertyService(
        "prop-1",
        validServiceInput({ rateAmountCents: -5 }),
        fakeClient as any
      ),
    PropertyServiceValidationErrorSet
  );
  assert.equal(fromCalled, false);
});

test("addPropertyService: on success inserts with the given propertyId and returns propertyServiceId", async () => {
  let insertedRow: Record<string, unknown> | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "property_services");
      return {
        insert(row: Record<string, unknown>) {
          insertedRow = row;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "svc-123" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const { propertyServiceId } = await addPropertyService(
    "prop-99",
    validServiceInput(),
    fakeClient as any
  );

  assert.equal(propertyServiceId, "svc-123");
  assert.ok(insertedRow);
  assert.equal((insertedRow as any).property_id, "prop-99");
  assert.equal((insertedRow as any).status, "active");
});
