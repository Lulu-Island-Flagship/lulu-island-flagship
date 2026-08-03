/**
 * Focused role-boundary tests for the "dispatch" resource used by
 * POST /api/admin/dispatch (src/app/api/admin/dispatch/route.ts), which
 * authorizes via requireAdminRole("dispatch", ...) -> roleAllows() /
 * matchingRole() in src/lib/admin-rbac.ts.
 *
 * Invariant: only owner_admin and ops_coordinator may dispatch employees to
 * an order. qc_only (the lowest-privilege admin role) must never be able to
 * dispatch, even though it shares the admin panel with the other two roles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { roleAllows, matchingRole, type AdminRole } from "../../src/lib/admin-rbac";

const DISPATCH = "dispatch" as const;

test("dispatch: qc_only is NOT allowed to dispatch", () => {
  assert.equal(roleAllows(["qc_only"], DISPATCH), false);
});

test("dispatch: ops_coordinator IS allowed to dispatch", () => {
  assert.equal(roleAllows(["ops_coordinator"], DISPATCH), true);
});

test("dispatch: owner_admin IS allowed to dispatch", () => {
  assert.equal(roleAllows(["owner_admin"], DISPATCH), true);
});

test("dispatch: a caller with no admin roles at all is NOT allowed to dispatch", () => {
  assert.equal(roleAllows([], DISPATCH), false);
});

test("dispatch: qc_only mixed with no other role is still rejected (no phantom access)", () => {
  const roles: AdminRole[] = ["qc_only"];
  assert.equal(roleAllows(roles, DISPATCH), false);
  assert.equal(matchingRole(roles, DISPATCH), null);
});

test("dispatch: a user holding both qc_only and ops_coordinator is authorized via ops_coordinator", () => {
  const roles: AdminRole[] = ["qc_only", "ops_coordinator"];
  assert.equal(roleAllows(roles, DISPATCH), true);
  assert.equal(matchingRole(roles, DISPATCH), "ops_coordinator");
});

test("dispatch: matchingRole reports owner_admin as the authorizing role when present", () => {
  const roles: AdminRole[] = ["owner_admin", "ops_coordinator"];
  assert.equal(matchingRole(roles, DISPATCH), "owner_admin");
});

test("dispatch: the dispatch boundary is strictly narrower than qc_wall (qc_only sees the QC wall but not dispatch)", () => {
  assert.equal(roleAllows(["qc_only"], "qc_wall"), true);
  assert.equal(roleAllows(["qc_only"], DISPATCH), false);
});
