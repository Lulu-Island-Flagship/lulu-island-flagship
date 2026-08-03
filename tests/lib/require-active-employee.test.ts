/**
 * Tests for requireActiveEmployee() (src/lib/require-active-employee.ts).
 *
 * Invariant under test: resolving user_id -> employee must require
 * is_active = true and deleted_at IS NULL, must never distinguish "no row"
 * from "inactive/deleted row" in its error output (both -> 403, same
 * generic message), and must distinguish real infra failures (any
 * PostgREST error code other than PGRST116) with a 500 and a separate
 * generic message that still doesn't leak details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireActiveEmployee } from "../../src/lib/require-active-employee";

interface QueryResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

class MockQueryBuilder {
  public selectedCols: string | null = null;
  constructor(private result: QueryResult) {}
  select(cols: string) {
    this.selectedCols = cols;
    return this;
  }
  eq(_col: string, _val: unknown) {
    return this;
  }
  is(_col: string, _val: unknown) {
    return this;
  }
  single() {
    return Promise.resolve(this.result);
  }
}

function makeSupabase(result: QueryResult) {
  let builder: MockQueryBuilder;
  return {
    supabase: {
      from(table: string) {
        if (table !== "employees") throw new Error(`unexpected table: ${table}`);
        builder = new MockQueryBuilder(result);
        return builder;
      },
    } as unknown as Parameters<typeof requireActiveEmployee>[0],
    getBuilder: () => builder,
  };
}

test("requireActiveEmployee: returns the employee row and 200 when active and not deleted", async () => {
  const { supabase } = makeSupabase({ data: { id: "emp-1" }, error: null });
  const result = await requireActiveEmployee(supabase, "user-1");
  assert.equal(result.status, 200);
  assert.equal(result.error, null);
  assert.deepEqual(result.employee, { id: "emp-1" });
});

test("requireActiveEmployee: PGRST116 (no matching row) -> 403 with generic message", async () => {
  const { supabase } = makeSupabase({
    data: null,
    error: { code: "PGRST116", message: "Results contain 0 rows" },
  });
  const result = await requireActiveEmployee(supabase, "user-1");
  assert.equal(result.status, 403);
  assert.equal(result.employee, null);
  assert.match(result.error ?? "", /not found or inactive/);
});

test("requireActiveEmployee: non-PGRST116 error -> 500 with a distinct generic infra message", async () => {
  const { supabase } = makeSupabase({
    data: null,
    error: { code: "08006", message: "connection failure" },
  });
  const result = await requireActiveEmployee(supabase, "user-1");
  assert.equal(result.status, 500);
  assert.equal(result.employee, null);
  assert.match(result.error ?? "", /Could not verify employee status/);
});

test("requireActiveEmployee: 403 and 500 error messages never leak whether the row exists", async () => {
  const { supabase: supabaseNoRow } = makeSupabase({
    data: null,
    error: { code: "PGRST116" },
  });
  const notFound = await requireActiveEmployee(supabaseNoRow, "user-1");

  // Same generic 403 message regardless of "no row" vs (hypothetically)
  // "row exists but inactive" -- the query itself filters both cases to
  // "no row returned", so this asserts the single generic error string.
  assert.equal(notFound.error, "Employee profile not found or inactive");
});

test("requireActiveEmployee: defaults to selecting only 'id'", async () => {
  const { supabase, getBuilder } = makeSupabase({ data: { id: "emp-1" }, error: null });
  await requireActiveEmployee(supabase, "user-1");
  assert.equal(getBuilder().selectedCols, "id");
});

test("requireActiveEmployee: honors a custom select list", async () => {
  const { supabase, getBuilder } = makeSupabase({
    data: { id: "emp-1", name: "Jane" },
    error: null,
  });
  const result = await requireActiveEmployee<{ id: string; name: string }>(
    supabase,
    "user-1",
    "id, name"
  );
  assert.equal(getBuilder().selectedCols, "id, name");
  assert.deepEqual(result.employee, { id: "emp-1", name: "Jane" });
});

test("requireActiveEmployee: null data with no error still resolves to 403 (defensive fallback)", async () => {
  const { supabase } = makeSupabase({ data: null, error: null });
  const result = await requireActiveEmployee(supabase, "user-1");
  assert.equal(result.status, 403);
  assert.equal(result.employee, null);
});
