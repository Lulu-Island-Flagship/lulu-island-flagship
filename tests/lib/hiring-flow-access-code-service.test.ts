import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidateSettingsCache } from "../../src/lib/hiring-flow/settings-service";
import {
  generateRawCode,
  hashCode,
  issueAccessCode,
  validateAccessCode,
  markAccessCodeUsed,
  AccessCodeInvalidError,
  AccessCodeExpiredError,
  AccessCodeAlreadyUsedError,
} from "../../src/lib/hiring-flow/access-code-service";

// ---------------------------------------------------------------------------
// generateRawCode — pure, no DB
// ---------------------------------------------------------------------------

test("generateRawCode: returns a string of the expected length", () => {
  const code = generateRawCode();
  assert.equal(typeof code, "string");
  assert.equal(code.length, 8);
});

test("generateRawCode: only uses the unambiguous alphabet (no 0/O/1/I, uppercase only)", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateRawCode();
    assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/);
    assert.doesNotMatch(code, /[01OI]/);
  }
});

test("generateRawCode: generates different codes across calls (no fixed seed)", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 50; i++) {
    codes.add(generateRawCode());
  }
  // Extremely unlikely to collide with 32^8 combinations; a low unique
  // count here would indicate a broken RNG or a hardcoded value.
  assert.ok(codes.size > 45, `expected mostly-unique codes, got ${codes.size}/50 unique`);
});

// ---------------------------------------------------------------------------
// hashCode — pure, no DB
// ---------------------------------------------------------------------------

test("hashCode: deterministic for the same input", () => {
  assert.equal(hashCode("ABCD1234"), hashCode("ABCD1234"));
});

test("hashCode: different for different inputs", () => {
  assert.notEqual(hashCode("ABCD1234"), hashCode("ABCD1235"));
});

test("hashCode: returns a hex sha256 digest (64 hex chars)", () => {
  const digest = hashCode("SOME-CODE");
  assert.match(digest, /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// Mock Supabase client — supports "system_settings" and "access_codes"
// ---------------------------------------------------------------------------

interface AccessCodeRow {
  id: string;
  candidate_id: string;
  code_hash: string;
  purpose: string;
  used_at: string | null;
  expires_at: string;
}

interface MockState {
  settingsRows: Array<{ key: string; value: string; value_type: "string" | "number" | "boolean" | "json" }>;
  accessCodeRows: AccessCodeRow[];
  inserted: any[];
  updated: any[];
}

function makeMockClient(state: MockState) {
  return {
    from(table: string) {
      if (table === "system_settings") {
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
      }

      if (table === "access_codes") {
        return {
          insert(obj: any) {
            state.inserted.push(obj);
            const row: AccessCodeRow = {
              id: `generated-${state.accessCodeRows.length + 1}`,
              candidate_id: obj.candidate_id,
              code_hash: obj.code_hash,
              purpose: obj.purpose,
              used_at: null,
              expires_at: obj.expires_at,
            };
            state.accessCodeRows.push(row);
            return Promise.resolve({ error: null });
          },
          select(_cols: string) {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(field: string, value: unknown) {
                filters[field] = value;
                return builder;
              },
              maybeSingle: async () => {
                const row = state.accessCodeRows.find(
                  (r) =>
                    (filters.candidate_id === undefined || r.candidate_id === filters.candidate_id) &&
                    (filters.purpose === undefined || r.purpose === filters.purpose) &&
                    (filters.code_hash === undefined || r.code_hash === filters.code_hash)
                );
                return { data: row ?? null, error: null };
              },
            };
            return builder;
          },
          update(patch: any) {
            state.updated.push(patch);
            return {
              eq: async (field: string, value: unknown) => {
                const row = state.accessCodeRows.find((r) => (r as any)[field] === value);
                if (row) Object.assign(row, patch);
                return { error: null };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table in mock: ${table}`);
    },
  } as any;
}

function baseState(overrides: Partial<MockState> = {}): MockState {
  return {
    settingsRows: [{ key: "security_code_expiry_days", value: "3", value_type: "number" }],
    accessCodeRows: [],
    inserted: [],
    updated: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// issueAccessCode
// ---------------------------------------------------------------------------

test("issueAccessCode: inserts a hashed code and returns raw code + expiresAt derived from settings", async () => {
  invalidateSettingsCache();
  const state = baseState();
  const client = makeMockClient(state);

  const before = Date.now();
  const result = await issueAccessCode("candidate-1", "step2", client);
  const after = Date.now();

  assert.equal(typeof result.rawCode, "string");
  assert.equal(result.rawCode.length, 8);
  assert.ok(result.expiresAt instanceof Date);

  const expectedMin = before + 3 * 24 * 60 * 60 * 1000;
  const expectedMax = after + 3 * 24 * 60 * 60 * 1000;
  assert.ok(result.expiresAt.getTime() >= expectedMin);
  assert.ok(result.expiresAt.getTime() <= expectedMax);

  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].candidate_id, "candidate-1");
  assert.equal(state.inserted[0].purpose, "step2");
  // Never stores the raw code, only its hash, and the hash must match.
  assert.notEqual(state.inserted[0].code_hash, result.rawCode);
  assert.equal(state.inserted[0].code_hash, hashCode(result.rawCode));
});

// ---------------------------------------------------------------------------
// validateAccessCode
// ---------------------------------------------------------------------------

test("validateAccessCode: valid, unused, unexpired code -> returns accessCodeId", async () => {
  invalidateSettingsCache();
  const rawCode = "ABCD2345";
  const state = baseState({
    accessCodeRows: [
      {
        id: "ac-1",
        candidate_id: "candidate-1",
        code_hash: hashCode(rawCode),
        purpose: "step2",
        used_at: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  });
  const client = makeMockClient(state);

  const result = await validateAccessCode("candidate-1", rawCode, "step2", client);
  assert.equal(result.accessCodeId, "ac-1");
});

test("validateAccessCode: nonexistent code -> AccessCodeInvalidError", async () => {
  invalidateSettingsCache();
  const state = baseState({ accessCodeRows: [] });
  const client = makeMockClient(state);

  await assert.rejects(
    () => validateAccessCode("candidate-1", "WRONGCOD", "step2", client),
    AccessCodeInvalidError
  );
});

test("validateAccessCode: already used code -> AccessCodeAlreadyUsedError", async () => {
  invalidateSettingsCache();
  const rawCode = "USEDCODE".slice(0, 8);
  const state = baseState({
    accessCodeRows: [
      {
        id: "ac-2",
        candidate_id: "candidate-1",
        code_hash: hashCode(rawCode),
        purpose: "step2",
        used_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  });
  const client = makeMockClient(state);

  await assert.rejects(
    () => validateAccessCode("candidate-1", rawCode, "step2", client),
    AccessCodeAlreadyUsedError
  );
});

test("validateAccessCode: expired code -> AccessCodeExpiredError", async () => {
  invalidateSettingsCache();
  const rawCode = "EXPIRED1";
  const state = baseState({
    accessCodeRows: [
      {
        id: "ac-3",
        candidate_id: "candidate-1",
        code_hash: hashCode(rawCode),
        purpose: "step2",
        used_at: null,
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
  });
  const client = makeMockClient(state);

  await assert.rejects(
    () => validateAccessCode("candidate-1", rawCode, "step2", client),
    AccessCodeExpiredError
  );
});

test("validateAccessCode: matching code but wrong purpose -> AccessCodeInvalidError", async () => {
  invalidateSettingsCache();
  const rawCode = "PURPOSE1";
  const state = baseState({
    accessCodeRows: [
      {
        id: "ac-4",
        candidate_id: "candidate-1",
        code_hash: hashCode(rawCode),
        purpose: "step3",
        used_at: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  });
  const client = makeMockClient(state);

  await assert.rejects(
    () => validateAccessCode("candidate-1", rawCode, "step2", client),
    AccessCodeInvalidError
  );
});

// ---------------------------------------------------------------------------
// markAccessCodeUsed
// ---------------------------------------------------------------------------

test("markAccessCodeUsed: sets used_at on the matching row", async () => {
  invalidateSettingsCache();
  const state = baseState({
    accessCodeRows: [
      {
        id: "ac-5",
        candidate_id: "candidate-1",
        code_hash: hashCode("MARKME12"),
        purpose: "step2",
        used_at: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  });
  const client = makeMockClient(state);

  await markAccessCodeUsed("ac-5", client);
  assert.notEqual(state.accessCodeRows[0].used_at, null);
});
