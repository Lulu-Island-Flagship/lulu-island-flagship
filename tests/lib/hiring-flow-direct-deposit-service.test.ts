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

const FAKE_ENCRYPTION_KEY = "test-encryption-key-not-real";
const getFakeEncryptionKeyFn = () => FAKE_ENCRYPTION_KEY;

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
// Mock Supabase client for candidate_banking_info -- ahora mockea .rpc()
// (set_candidate_banking_info / get_candidate_banking_info), no
// .from().upsert()/.select(), porque el servicio real (migración 284)
// cifra/descifra dentro de esas funciones de Postgres, nunca toca las
// columnas directo. El mock simula el cifrado con un prefijo simple --
// suficiente para probar la lógica de TypeScript (mapeo de filas, UPSERT
// por candidate_id, propagación de la clave), sin reimplementar pgcrypto.
// ---------------------------------------------------------------------------

interface StoredRow {
  candidateId: string;
  transit: string;
  institution: string;
  account: string;
}

interface RpcArgs {
  p_candidate_id: string;
  p_transit_number?: string;
  p_institution_number?: string;
  p_account_number?: string;
  p_encryption_key: string;
}

interface MockState {
  rows: StoredRow[];
  rpcCalls: Array<{ fn: string; args: RpcArgs }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockClient(state: MockState): any {
  let nextId = 1;
  return {
    rpc(fn: string, args: RpcArgs) {
      state.rpcCalls.push({ fn, args });

      if (fn === "set_candidate_banking_info") {
        assert.equal(args.p_encryption_key, FAKE_ENCRYPTION_KEY);
        let row = state.rows.find((r) => r.candidateId === args.p_candidate_id);
        if (row) {
          row.transit = args.p_transit_number as string;
          row.institution = args.p_institution_number as string;
          row.account = args.p_account_number as string;
        } else {
          row = {
            candidateId: args.p_candidate_id,
            transit: args.p_transit_number as string,
            institution: args.p_institution_number as string,
            account: args.p_account_number as string,
          };
          state.rows.push(row);
        }
        return Promise.resolve({ data: `generated-${nextId++}`, error: null });
      }

      if (fn === "get_candidate_banking_info") {
        assert.equal(args.p_encryption_key, FAKE_ENCRYPTION_KEY);
        const row = state.rows.find((r) => r.candidateId === args.p_candidate_id);
        if (!row) {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({
          data: [
            {
              transit_number: row.transit,
              institution_number: row.institution,
              account_number: row.account,
            },
          ],
          error: null,
        });
      }

      throw new Error(`Unexpected RPC call in test mock: ${fn}`);
    },
  };
}

function baseState(overrides: Partial<MockState> = {}): MockState {
  return { rows: [], rpcCalls: [], ...overrides };
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
    () => setCandidateDirectDeposit("candidate-1", badInput, client, getFakeEncryptionKeyFn),
    DirectDepositValidationError
  );
  assert.equal(state.rpcCalls.length, 0, "no RPC call should happen when validation fails");
});

test("setCandidateDirectDeposit: valid input -> calls set_candidate_banking_info RPC with the encryption key", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  const goodInput: DirectDepositInput = {
    transitNumber: "12345",
    institutionNumber: "001",
    accountNumber: "1234567",
  };

  const result = await setCandidateDirectDeposit(
    "candidate-1",
    goodInput,
    client,
    getFakeEncryptionKeyFn
  );
  assert.equal(typeof result.id, "string");
  assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.rpcCalls[0].fn, "set_candidate_banking_info");
  assert.equal(state.rpcCalls[0].args.p_candidate_id, "candidate-1");
  assert.equal(state.rpcCalls[0].args.p_transit_number, "12345");
});

test("setCandidateDirectDeposit: missing encryption key -> throws HiringFlowEncryptionKeyMissingError-like error, never calls RPC", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  await assert.rejects(() =>
    setCandidateDirectDeposit(
      "candidate-1",
      { transitNumber: "12345", institutionNumber: "001", accountNumber: "1234567" },
      client,
      () => {
        throw new Error("HIRING_FLOW_ENCRYPTION_KEY no configurada");
      }
    )
  );
  assert.equal(state.rpcCalls.length, 0);
});

test("setCandidateDirectDeposit: second call for same candidate updates the existing row (no accumulation)", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  await setCandidateDirectDeposit(
    "candidate-1",
    { transitNumber: "12345", institutionNumber: "001", accountNumber: "1234567" },
    client,
    getFakeEncryptionKeyFn
  );
  await setCandidateDirectDeposit(
    "candidate-1",
    { transitNumber: "99999", institutionNumber: "002", accountNumber: "9999999" },
    client,
    getFakeEncryptionKeyFn
  );

  assert.equal(state.rows.length, 1, "a candidate should only ever have one banking info row");
  assert.equal(state.rows[0].transit, "99999");
});

// ---------------------------------------------------------------------------
// getCandidateDirectDeposit
// ---------------------------------------------------------------------------

test("getCandidateDirectDeposit: existing candidate -> returns mapped, decrypted fields", async () => {
  const state = baseState({
    rows: [
      {
        candidateId: "candidate-1",
        transit: "12345",
        institution: "001",
        account: "1234567",
      },
    ],
  });
  const client = makeMockClient(state);

  const result = await getCandidateDirectDeposit("candidate-1", client, getFakeEncryptionKeyFn);
  assert.deepEqual(result, {
    transitNumber: "12345",
    institutionNumber: "001",
    accountNumber: "1234567",
  });
});

test("getCandidateDirectDeposit: no banking info for candidate -> null", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  const result = await getCandidateDirectDeposit("candidate-1", client, getFakeEncryptionKeyFn);
  assert.equal(result, null);
});
