/**
 * Tests for requireClientCaller() (src/lib/require-client-caller.ts).
 *
 * Invariant under test: any authenticated caller with an active row in
 * `employees` (is_active = true, deleted_at IS NULL) OR any row in
 * `admin_roles` (deleted_at IS NULL) must be rejected (403) from
 * /api/client/** routes, regardless of whether they also have a `clients`
 * row. The rejection message/status must be identical no matter which of
 * the two tables triggered it (never reveal which one).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireClientCaller } from "../../src/lib/require-client-caller";

interface QueryResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

class MockQueryBuilder {
  constructor(private result: QueryResult) {}
  select(_cols: string) {
    return this;
  }
  eq(_col: string, _val: unknown) {
    return this;
  }
  is(_col: string, _val: unknown) {
    return this;
  }
  maybeSingle() {
    return Promise.resolve(this.result);
  }
}

function makeSupabase(opts: {
  employees?: QueryResult;
  adminRoles?: QueryResult;
}) {
  const employees = opts.employees ?? { data: null, error: null };
  const adminRoles = opts.adminRoles ?? { data: null, error: null };
  return {
    from(table: string) {
      if (table === "employees") return new MockQueryBuilder(employees);
      if (table === "admin_roles") return new MockQueryBuilder(adminRoles);
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as Parameters<typeof requireClientCaller>[0];
}

test("requireClientCaller: allows a caller with no employee and no admin row", async () => {
  const supabase = makeSupabase({});
  const result = await requireClientCaller(supabase, "user-1");
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.error, null);
});

test("requireClientCaller: rejects an active employee (403)", async () => {
  const supabase = makeSupabase({
    employees: { data: { id: "emp-1" }, error: null },
  });
  const result = await requireClientCaller(supabase, "user-1");
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.match(result.error ?? "", /Forbidden/);
});

test("requireClientCaller: rejects an admin_roles holder (403)", async () => {
  const supabase = makeSupabase({
    adminRoles: { data: { id: "role-1" }, error: null },
  });
  const result = await requireClientCaller(supabase, "user-1");
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.match(result.error ?? "", /Forbidden/);
});

test("requireClientCaller: rejects a caller who is both employee and admin (403)", async () => {
  const supabase = makeSupabase({
    employees: { data: { id: "emp-1" }, error: null },
    adminRoles: { data: { id: "role-1" }, error: null },
  });
  const result = await requireClientCaller(supabase, "user-1");
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("requireClientCaller: employee-triggered and admin-triggered rejections have identical error/status (never reveal which table)", async () => {
  const supabase1 = makeSupabase({ employees: { data: { id: "emp-1" }, error: null } });
  const supabase2 = makeSupabase({ adminRoles: { data: { id: "role-1" }, error: null } });
  const result1 = await requireClientCaller(supabase1, "user-1");
  const result2 = await requireClientCaller(supabase2, "user-1");
  assert.equal(result1.error, result2.error);
  assert.equal(result1.status, result2.status);
});

test("requireClientCaller: returns 500 with generic infra error when employees query errors", async () => {
  const supabase = makeSupabase({
    employees: { data: null, error: { message: "connection reset" } },
  });
  const result = await requireClientCaller(supabase, "user-1");
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.match(result.error ?? "", /Could not verify caller role/);
});

test("requireClientCaller: returns 500 with generic infra error when admin_roles query errors", async () => {
  const supabase = makeSupabase({
    adminRoles: { data: null, error: { message: "timeout" } },
  });
  const result = await requireClientCaller(supabase, "user-1");
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.match(result.error ?? "", /Could not verify caller role/);
});
