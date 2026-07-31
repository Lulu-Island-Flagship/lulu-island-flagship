import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidateSettingsCache } from "../../src/lib/hiring-flow/settings-service";
import { calculateTd1 } from "../../src/lib/hiring-flow/td1-service";

// ---------------------------------------------------------------------------
// Mock Supabase client -- supports "system_settings" only (td1-service
// only reads settings, never touches candidate/banking tables directly)
// ---------------------------------------------------------------------------

interface MockState {
  settingsRows: Array<{ key: string; value: string; value_type: "string" | "number" | "boolean" | "json" }>;
}

function makeMockClient(state: MockState) {
  return {
    from(table: string) {
      assert.equal(table, "system_settings");
      return {
        select(_cols: string) {
          return {
            eq(_field: string, value: unknown) {
              const row = state.settingsRows.find((r) => r.key === value);
              return {
                single: async () => {
                  if (!row) return { data: null, error: { message: "not found" } };
                  return { data: { value: row.value, value_type: row.value_type }, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as any;
}

function baseState(overrides: Partial<MockState> = {}): MockState {
  return {
    settingsRows: [
      { key: "tax_year", value: "2026", value_type: "number" },
      { key: "tax_federal_basic_personal_amount", value: "15705", value_type: "number" },
      // tax_bc_basic_personal_amount intentionally NOT seeded here to
      // exercise the getSettingOrDefault placeholder path.
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// calculateTd1
// ---------------------------------------------------------------------------

test("calculateTd1: reads tax_year and federal basic personal amount from settings, converts to cents", async () => {
  invalidateSettingsCache();
  const state = baseState();
  const client = makeMockClient(state);

  const result = await calculateTd1({ candidateId: "candidate-1" }, client);

  assert.equal(result.taxYear, 2026);
  assert.equal(result.federalBasicPersonalAmountCents, 1570500);
});

test("calculateTd1: falls back to placeholder for tax_bc_basic_personal_amount when not seeded", async () => {
  invalidateSettingsCache();
  const state = baseState();
  const client = makeMockClient(state);

  const result = await calculateTd1({ candidateId: "candidate-1" }, client);

  // Placeholder documented in td1-service.ts as [ASSUMPTION]: 12580 dollars.
  assert.equal(result.bcBasicPersonalAmountCents, 1258000);
});

test("calculateTd1: uses the seeded value for tax_bc_basic_personal_amount when present", async () => {
  invalidateSettingsCache();
  const state = baseState({
    settingsRows: [
      { key: "tax_year", value: "2026", value_type: "number" },
      { key: "tax_federal_basic_personal_amount", value: "15705", value_type: "number" },
      { key: "tax_bc_basic_personal_amount", value: "12580", value_type: "number" },
    ],
  });
  const client = makeMockClient(state);

  const result = await calculateTd1({ candidateId: "candidate-1" }, client);
  assert.equal(result.bcBasicPersonalAmountCents, 1258000);
});

test("calculateTd1: settingsUsed reflects exactly what was read from settings", async () => {
  invalidateSettingsCache();
  const state = baseState();
  const client = makeMockClient(state);

  const result = await calculateTd1({ candidateId: "candidate-1" }, client);

  assert.deepEqual(result.settingsUsed, {
    tax_year: 2026,
    tax_federal_basic_personal_amount: 15705,
    tax_bc_basic_personal_amount: 12580,
  });
});

test("calculateTd1: includes claimAdditionalAmount (in cents) in the total", async () => {
  invalidateSettingsCache();
  const state = baseState();
  const client = makeMockClient(state);

  const result = await calculateTd1(
    { candidateId: "candidate-1", claimAdditionalAmount: 5000 },
    client
  );

  assert.equal(result.claimAdditionalAmountCents, 5000);
  assert.equal(
    result.totalClaimAmountCents,
    result.federalBasicPersonalAmountCents + result.bcBasicPersonalAmountCents + 5000
  );
});

test("calculateTd1: rejects a non-integer/negative claimAdditionalAmount (money must be integer cents)", async () => {
  invalidateSettingsCache();
  const state = baseState();
  const client = makeMockClient(state);

  await assert.rejects(() =>
    calculateTd1({ candidateId: "candidate-1", claimAdditionalAmount: 12.5 }, client)
  );
  await assert.rejects(() =>
    calculateTd1({ candidateId: "candidate-1", claimAdditionalAmount: -1 }, client)
  );
});

test("calculateTd1: logs a structured JSON console.log with candidateId, taxYear, and settingsUsed", async () => {
  invalidateSettingsCache();
  const state = baseState();
  const client = makeMockClient(state);

  const originalConsoleLog = console.log;
  const logCalls: unknown[][] = [];
  console.log = (...args: unknown[]) => {
    logCalls.push(args);
  };

  try {
    await calculateTd1({ candidateId: "candidate-42" }, client);
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(logCalls.length, 1, "expected exactly one console.log call during calculation");
  const [loggedArg] = logCalls[0];
  assert.equal(typeof loggedArg, "string");
  const parsed = JSON.parse(loggedArg as string);

  assert.equal(parsed.candidateId, "candidate-42");
  assert.equal(parsed.taxYear, 2026);
  assert.deepEqual(parsed.settingsUsed, {
    tax_year: 2026,
    tax_federal_basic_personal_amount: 15705,
    tax_bc_basic_personal_amount: 12580,
  });
});

test("calculateTd1: throws when tax_year setting is missing", async () => {
  invalidateSettingsCache();
  const state = baseState({
    settingsRows: [
      { key: "tax_federal_basic_personal_amount", value: "15705", value_type: "number" },
    ],
  });
  const client = makeMockClient(state);

  await assert.rejects(() => calculateTd1({ candidateId: "candidate-1" }, client));
});
