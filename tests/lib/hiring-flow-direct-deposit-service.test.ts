import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidTransitNumber,
  isValidInstitutionNumber,
  isValidAccountNumber,
  validateDirectDepositInput,
  DirectDepositValidationError,
  setCandidateDirectDeposit,
  getCandidateDirectDeposit,
  type DirectDepositInput,
} from "../../src/lib/hiring-flow/direct-deposit-service";

// ---------------------------------------------------------------------------
// isValidTransitNumber
// ---------------------------------------------------------------------------

test("isValidTransitNumber: exactly 5 digits -> true", () => {
  assert.equal(isValidTransitNumber("12345"), true);
});

test("isValidTransitNumber: wrong length -> false", () => {
  assert.equal(isValidTransitNumber("1234"), false);
  assert.equal(isValidTransitNumber("123456"), false);
  assert.equal(isValidTransitNumber(""), false);
});

test("isValidTransitNumber: non-digit characters -> false", () => {
  assert.equal(isValidTransitNumber("12a45"), false);
  assert.equal(isValidTransitNumber("1234 "), false);
});

// ---------------------------------------------------------------------------
// isValidInstitutionNumber
// ---------------------------------------------------------------------------

test("isValidInstitutionNumber: exactly 3 digits -> true", () => {
  assert.equal(isValidInstitutionNumber("001"), true);
  assert.equal(isValidInstitutionNumber("003"), true);
});

test("isValidInstitutionNumber: wrong length -> false", () => {
  assert.equal(isValidInstitutionNumber("01"), false);
  assert.equal(isValidInstitutionNumber("0011"), false);
  assert.equal(isValidInstitutionNumber(""), false);
});

test("isValidInstitutionNumber: non-digit characters -> false", () => {
  assert.equal(isValidInstitutionNumber("0a1"), false);
});

// ---------------------------------------------------------------------------
// isValidAccountNumber
// ---------------------------------------------------------------------------

test("isValidAccountNumber: within 7-12 digits -> true", () => {
  assert.equal(isValidAccountNumber("1234567"), true);
  assert.equal(isValidAccountNumber("123456789012"), true);
  assert.equal(isValidAccountNumber("123456789"), true);
});

test("isValidAccountNumber: too short or too long -> false", () => {
  assert.equal(isValidAccountNumber("123456"), false);
  assert.equal(isValidAccountNumber("1234567890123"), false);
});

test("isValidAccountNumber: non-digit characters -> false", () => {
  assert.equal(isValidAccountNumber("12345a7"), false);
});

// ---------------------------------------------------------------------------
// validateDirectDepositInput -- pure, accumulates all errors
// ---------------------------------------------------------------------------

test("validateDirectDepositInput: all valid -> no errors", () => {
  const errors = validateDirectDepositInput({
    transitNumber: "12345",
    institutionNumber: "001",
    accountNumber: "1234567",
  });
  assert.deepEqual(errors, []);
});

test("validateDirectDepositInput: invalid transitNumber only -> one error for that field", () => {
  const errors = validateDirectDepositInput({
    transitNumber: "abc",
    institutionNumber: "001",
    accountNumber: "1234567",
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "transitNumber");
});

test("validateDirectDepositInput: invalid institutionNumber only -> one error for that field", () => {
  const errors = validateDirectDepositInput({
    transitNumber: "12345",
    institutionNumber: "1",
    accountNumber: "1234567",
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "institutionNumber");
});

test("validateDirectDepositInput: invalid accountNumber only -> one error for that field", () => {
  const errors = validateDirectDepositInput({
    transitNumber: "12345",
    institutionNumber: "001",
    accountNumber: "123",
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "accountNumber");
});

test("validateDirectDepositInput: all invalid -> accumulates all three errors, does not short-circuit", () => {
  const errors = validateDirectDepositInput({
    transitNumber: "x",
    institutionNumber: "y",
    accountNumber: "z",
  });
  assert.equal(errors.length, 3);
  const fields = errors.map((e) => e.field);
  assert.deepEqual(fields.sort(), ["accountNumber", "institutionNumber", "transitNumber"]);
});

// ---------------------------------------------------------------------------
// Mock Supabase client for candidate_banking_info
// ---------------------------------------------------------------------------

interface BankingRow {
  id: string;
  candidate_id: string;
  transit_number: string;
  institution_number: string;
  account_number: string;
}

interface MockState {
  rows: BankingRow[];
  upserts: any[];
}

function makeMockClient(state: MockState) {
  let nextId = 1;
  return {
    from(table: string) {
      assert.equal(table, "candidate_banking_info");
      return {
        upsert(obj: any, _opts: { onConflict: string }) {
          state.upserts.push(obj);
          let row = state.rows.find((r) => r.candidate_id === obj.candidate_id);
          if (row) {
            row.transit_number = obj.transit_number;
            row.institution_number = obj.institution_number;
            row.account_number = obj.account_number;
          } else {
            row = {
              id: `generated-${nextId++}`,
              candidate_id: obj.candidate_id,
              transit_number: obj.transit_number,
              institution_number: obj.institution_number,
              account_number: obj.account_number,
            };
            state.rows.push(row);
          }
          return {
            select(_cols: string) {
              return {
                single: async () => ({ data: { id: row!.id }, error: null }),
              };
            },
          };
        },
        select(_cols: string) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(field: string, value: unknown) {
              filters[field] = value;
              return builder;
            },
            maybeSingle: async () => {
              const row = state.rows.find((r) => r.candidate_id === filters.candidate_id);
              return { data: row ?? null, error: null };
            },
          };
          return builder;
        },
      };
    },
  } as any;
}

function baseState(overrides: Partial<MockState> = {}): MockState {
  return { rows: [], upserts: [], ...overrides };
}

// ---------------------------------------------------------------------------
// setCandidateDirectDeposit
// ---------------------------------------------------------------------------

test("setCandidateDirectDeposit: invalid input -> throws DirectDepositValidationError, never touches DB", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  const badInput: DirectDepositInput = {
    transitNumber: "bad",
    institutionNumber: "bad",
    accountNumber: "bad",
  };

  await assert.rejects(
    () => setCandidateDirectDeposit("candidate-1", badInput, client),
    DirectDepositValidationError
  );
  assert.equal(state.upserts.length, 0, "no upsert should happen when validation fails");
});

test("setCandidateDirectDeposit: valid input -> upserts with onConflict candidate_id", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  const goodInput: DirectDepositInput = {
    transitNumber: "12345",
    institutionNumber: "001",
    accountNumber: "1234567",
  };

  const result = await setCandidateDirectDeposit("candidate-1", goodInput, client);
  assert.equal(typeof result.id, "string");
  assert.equal(state.upserts.length, 1);
  assert.equal(state.upserts[0].candidate_id, "candidate-1");
  assert.equal(state.upserts[0].transit_number, "12345");
});

test("setCandidateDirectDeposit: second call for same candidate updates the existing row (no accumulation)", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  await setCandidateDirectDeposit(
    "candidate-1",
    { transitNumber: "12345", institutionNumber: "001", accountNumber: "1234567" },
    client
  );
  await setCandidateDirectDeposit(
    "candidate-1",
    { transitNumber: "99999", institutionNumber: "002", accountNumber: "9999999" },
    client
  );

  assert.equal(state.rows.length, 1, "a candidate should only ever have one banking info row");
  assert.equal(state.rows[0].transit_number, "99999");
});

// ---------------------------------------------------------------------------
// getCandidateDirectDeposit
// ---------------------------------------------------------------------------

test("getCandidateDirectDeposit: existing candidate -> returns mapped fields", async () => {
  const state = baseState({
    rows: [
      {
        id: "b-1",
        candidate_id: "candidate-1",
        transit_number: "12345",
        institution_number: "001",
        account_number: "1234567",
      },
    ],
  });
  const client = makeMockClient(state);

  const result = await getCandidateDirectDeposit("candidate-1", client);
  assert.deepEqual(result, {
    transitNumber: "12345",
    institutionNumber: "001",
    accountNumber: "1234567",
  });
});

test("getCandidateDirectDeposit: no banking info for candidate -> null", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  const result = await getCandidateDirectDeposit("candidate-1", client);
  assert.equal(result, null);
});
