import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidateSettingsCache } from "../../src/lib/hiring-flow/settings-service";
import { checkRateLimit, resetRateLimiterState } from "../../src/lib/hiring-flow/rate-limiter";

// ---------------------------------------------------------------------------
// Mock Supabase client — supports "system_settings" only
// ---------------------------------------------------------------------------

interface SettingsRow {
  key: string;
  value: string;
  value_type: "string" | "number" | "boolean" | "json";
}

function makeSettingsMockClient(rows: SettingsRow[]) {
  return {
    from(table: string) {
      if (table !== "system_settings") {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return {
        select(_cols: string) {
          return {
            eq(_field: string, value: unknown) {
              const row = rows.find((r) => r.key === value);
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

// Simulates the DB itself being unreachable (not just a missing key): any
// query throws, which is what a real network/connection failure would look
// like when awaited through the Supabase client.
function makeThrowingClient() {
  return {
    from(_table: string) {
      throw new Error("simulated DB connection failure");
    },
  } as any;
}

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

test("checkRateLimit: allows requests within the configured limit", async () => {
  invalidateSettingsCache();
  resetRateLimiterState();
  const client = makeSettingsMockClient([
    { key: "security_rate_limit_validation", value: "3", value_type: "number" },
  ]);

  const r1 = await checkRateLimit("candidate-1:validate", "security_rate_limit_validation", client);
  const r2 = await checkRateLimit("candidate-1:validate", "security_rate_limit_validation", client);
  const r3 = await checkRateLimit("candidate-1:validate", "security_rate_limit_validation", client);

  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, true);
  assert.equal(r3.remaining, 0);
});

test("checkRateLimit: blocks once the limit is exceeded within the window", async () => {
  invalidateSettingsCache();
  resetRateLimiterState();
  const client = makeSettingsMockClient([
    { key: "security_rate_limit_validation", value: "2", value_type: "number" },
  ]);

  await checkRateLimit("candidate-2:validate", "security_rate_limit_validation", client);
  await checkRateLimit("candidate-2:validate", "security_rate_limit_validation", client);
  const third = await checkRateLimit("candidate-2:validate", "security_rate_limit_validation", client);

  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
});

test("checkRateLimit: different keys are tracked independently", async () => {
  invalidateSettingsCache();
  resetRateLimiterState();
  const client = makeSettingsMockClient([
    { key: "security_rate_limit_validation", value: "1", value_type: "number" },
  ]);

  const a1 = await checkRateLimit("candidate-a:validate", "security_rate_limit_validation", client);
  const b1 = await checkRateLimit("candidate-b:validate", "security_rate_limit_validation", client);

  assert.equal(a1.allowed, true);
  assert.equal(b1.allowed, true);

  const a2 = await checkRateLimit("candidate-a:validate", "security_rate_limit_validation", client);
  assert.equal(a2.allowed, false, "candidate-a should now be blocked, independent of candidate-b");
});

test("checkRateLimit: fails open (allowed=true, remaining=-1) when the setting key doesn't exist", async () => {
  invalidateSettingsCache();
  resetRateLimiterState();
  const client = makeSettingsMockClient([]); // no rows -> SettingNotFoundError inside getSetting

  const result = await checkRateLimit("candidate-3:validate", "security_rate_limit_missing", client);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, -1);
});

test("checkRateLimit: fails open when reading the setting throws (simulated DB outage)", async () => {
  invalidateSettingsCache();
  resetRateLimiterState();
  const client = makeThrowingClient();

  const result = await checkRateLimit("candidate-4:validate", "security_rate_limit_validation", client);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, -1);
});

test("checkRateLimit: fails open when the configured limit is not a valid positive number", async () => {
  invalidateSettingsCache();
  resetRateLimiterState();
  const client = makeSettingsMockClient([
    { key: "security_rate_limit_validation", value: "not-a-number", value_type: "string" },
  ]);

  const result = await checkRateLimit("candidate-5:validate", "security_rate_limit_validation", client);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, -1);
});
