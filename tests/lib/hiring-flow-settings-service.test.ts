import { test } from "node:test";
import assert from "node:assert/strict";
import {
  castValue,
  getSetting,
  getSettingOrDefault,
  getAllPublicSettings,
  invalidateSettingsCache,
  SettingNotFoundError,
} from "../../src/lib/hiring-flow/settings-service";

// ---------------------------------------------------------------------------
// castValue — pure, no DB
// ---------------------------------------------------------------------------

test("castValue: 'string' passthrough", () => {
  assert.equal(castValue("hello world", "string"), "hello world");
  assert.equal(castValue("", "string"), "");
});

test("castValue: 'number' integer", () => {
  assert.equal(castValue("42", "number"), 42);
});

test("castValue: 'number' decimal -> float", () => {
  assert.equal(castValue("0.70", "number"), 0.7);
  assert.equal(castValue("3.14159", "number"), 3.14159);
});

test("castValue: 'number' negative", () => {
  assert.equal(castValue("-12.5", "number"), -12.5);
});

test("castValue: 'number' invalid -> throws (never silent NaN)", () => {
  assert.throws(() => castValue("not-a-number", "number"), /number/i);
  assert.throws(() => castValue("", "number"), /number/i);
  assert.throws(() => castValue("12abc", "number"), /number/i);
});

test("castValue: 'boolean' true/false case-insensitive", () => {
  assert.equal(castValue("true", "boolean"), true);
  assert.equal(castValue("false", "boolean"), false);
  assert.equal(castValue("TRUE", "boolean"), true);
  assert.equal(castValue("False", "boolean"), false);
  assert.equal(castValue("TrUe", "boolean"), true);
});

test("castValue: 'boolean' invalid -> throws", () => {
  assert.throws(() => castValue("yes", "boolean"), /boolean/i);
  assert.throws(() => castValue("1", "boolean"), /boolean/i);
  assert.throws(() => castValue("", "boolean"), /boolean/i);
});

test("castValue: 'json' valid object/array/primitive", () => {
  assert.deepEqual(castValue('{"a":1,"b":"two"}', "json"), { a: 1, b: "two" });
  assert.deepEqual(castValue("[1,2,3]", "json"), [1, 2, 3]);
  assert.equal(castValue("42", "json"), 42);
  assert.equal(castValue("true", "json"), true);
});

test("castValue: 'json' invalid -> throws with clear message", () => {
  assert.throws(() => castValue("{not valid json", "json"), /json/i);
  assert.throws(() => castValue("", "json"), /json/i);
});

test("castValue: unknown value_type -> throws", () => {
  assert.throws(() => castValue("x", "weird" as any), /value_type/i);
});

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

interface FakeRow {
  key: string;
  value: string | null;
  value_type: "string" | "number" | "boolean" | "json";
  is_public?: boolean;
}

function makeMockClient(rows: FakeRow[], callCounter: { count: number }) {
  return {
    from(table: string) {
      assert.equal(table, "system_settings");
      return {
        select(_cols: string) {
          return {
            eq(field: string, value: unknown) {
              callCounter.count += 1;
              if (field === "key") {
                const row = rows.find((r) => r.key === value);
                return {
                  single: async () => {
                    if (!row) {
                      return { data: null, error: { message: "not found" } };
                    }
                    return {
                      data: { value: row.value, value_type: row.value_type },
                      error: null,
                    };
                  },
                };
              }
              if (field === "is_public") {
                const filtered = rows.filter((r) => r.is_public === value);
                // getAllPublicSettings does not call .single(), it awaits directly
                return Promise.resolve({
                  data: filtered.map((r) => ({
                    key: r.key,
                    value: r.value,
                    value_type: r.value_type,
                  })),
                  error: null,
                });
              }
              throw new Error(`Unexpected eq field in mock: ${field}`);
            },
          };
        },
      };
    },
  } as any;
}

// ---------------------------------------------------------------------------
// getSetting
// ---------------------------------------------------------------------------

test("getSetting: key does not exist -> SettingNotFoundError", async () => {
  invalidateSettingsCache();
  const callCounter = { count: 0 };
  const client = makeMockClient([], callCounter);

  await assert.rejects(
    () => getSetting("nonexistent.key", client),
    SettingNotFoundError
  );
});

test("getSetting: value_type number '0.70' -> returns float 0.7", async () => {
  invalidateSettingsCache();
  const callCounter = { count: 0 };
  const client = makeMockClient(
    [{ key: "pricing.discount_rate", value: "0.70", value_type: "number" }],
    callCounter
  );

  const result = await getSetting("pricing.discount_rate", client);
  assert.equal(result, 0.7);
});

test("getSetting: caches result, second call for same key does not hit mock again", async () => {
  invalidateSettingsCache();
  const callCounter = { count: 0 };
  const client = makeMockClient(
    [{ key: "cache.test.key", value: "0.70", value_type: "number" }],
    callCounter
  );

  const first = await getSetting("cache.test.key", client);
  const countAfterFirst = callCounter.count;
  assert.ok(countAfterFirst >= 1, "mock should be hit on first (uncached) call");

  const second = await getSetting("cache.test.key", client);
  assert.equal(callCounter.count, countAfterFirst, "second call should be served from cache, no new mock call");
  assert.equal(first, 0.7);
  assert.equal(second, 0.7);
});

test("getSetting: cache is per-key, different key still hits mock", async () => {
  invalidateSettingsCache();
  const callCounter = { count: 0 };
  const client = makeMockClient(
    [
      { key: "key.a", value: "1", value_type: "number" },
      { key: "key.b", value: "2", value_type: "number" },
    ],
    callCounter
  );

  await getSetting("key.a", client);
  const afterA = callCounter.count;
  await getSetting("key.b", client);
  assert.ok(callCounter.count > afterA, "different key should trigger a new mock call");
});

// ---------------------------------------------------------------------------
// getSettingOrDefault
// ---------------------------------------------------------------------------

test("getSettingOrDefault: key exists -> returns real casted value", async () => {
  invalidateSettingsCache();
  const callCounter = { count: 0 };
  const client = makeMockClient(
    [{ key: "feature.enabled", value: "true", value_type: "boolean" }],
    callCounter
  );

  const result = await getSettingOrDefault("feature.enabled", false, client);
  assert.equal(result, true);
});

test("getSettingOrDefault: key missing -> returns default, no throw", async () => {
  invalidateSettingsCache();
  const callCounter = { count: 0 };
  const client = makeMockClient([], callCounter);

  const result = await getSettingOrDefault("does.not.exist", "fallback-value", client);
  assert.equal(result, "fallback-value");
});

// ---------------------------------------------------------------------------
// getAllPublicSettings
// ---------------------------------------------------------------------------

test("getAllPublicSettings: returns only is_public=true rows, casted", async () => {
  invalidateSettingsCache();
  const callCounter = { count: 0 };
  const client = makeMockClient(
    [
      { key: "public.a", value: "10", value_type: "number", is_public: true },
      { key: "public.b", value: "true", value_type: "boolean", is_public: true },
      { key: "private.c", value: "secret", value_type: "string", is_public: false },
    ],
    callCounter
  );

  const all = await getAllPublicSettings(client);
  assert.deepEqual(all, { "public.a": 10, "public.b": true });
  assert.equal("private.c" in all, false);
});

// ---------------------------------------------------------------------------
// invalidateSettingsCache
// ---------------------------------------------------------------------------

test("invalidateSettingsCache: with key clears only that entry", async () => {
  invalidateSettingsCache();
  const callCounter = { count: 0 };
  const client = makeMockClient(
    [
      { key: "inv.a", value: "1", value_type: "number" },
      { key: "inv.b", value: "2", value_type: "number" },
    ],
    callCounter
  );

  await getSetting("inv.a", client);
  await getSetting("inv.b", client);
  const countAfterBoth = callCounter.count;

  invalidateSettingsCache("inv.a");

  await getSetting("inv.a", client); // should hit mock again
  const countAfterAReload = callCounter.count;
  assert.ok(countAfterAReload > countAfterBoth, "inv.a should have been re-fetched");

  await getSetting("inv.b", client); // should still be cached
  assert.equal(callCounter.count, countAfterAReload, "inv.b should still be cached, untouched");
});

test("invalidateSettingsCache: without key clears everything", async () => {
  invalidateSettingsCache();
  const callCounter = { count: 0 };
  const client = makeMockClient(
    [
      { key: "wipe.a", value: "1", value_type: "number" },
      { key: "wipe.b", value: "2", value_type: "number" },
    ],
    callCounter
  );

  await getSetting("wipe.a", client);
  await getSetting("wipe.b", client);
  const countAfterBoth = callCounter.count;

  invalidateSettingsCache();

  await getSetting("wipe.a", client);
  assert.ok(callCounter.count > countAfterBoth, "wipe.a should be re-fetched after full invalidation");
});
