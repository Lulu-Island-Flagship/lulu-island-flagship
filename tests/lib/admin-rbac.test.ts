/**
 * v8.3 E0-C3 — Tests de la matriz RBAC administrativa.
 * Criterio de aceptación E0: "el rol Solo-QC no puede leer nómina ni finanzas".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { roleAllows, allowedResources, type AdminResource } from "../../src/lib/admin-rbac";

const FINANCE_RESOURCES: AdminResource[] = [
  "pricing_settings",
  "pricing_rules",
  "hhe_settings",
  "payroll",
  "employees_admin",
  "finance",
];

const OPS_RESOURCES: AdminResource[] = [
  "dispatch",
  "services",
  "quotes_review",
  "tickets",
  "upsells_review",
  "checklists_sop",
  "vehicles",
  "field_audits",
];

test("qc_only NO accede a NINGÚN recurso de finanzas ni nómina", () => {
  for (const res of FINANCE_RESOURCES) {
    assert.equal(
      roleAllows(["qc_only"], res),
      false,
      `qc_only NO debe acceder a '${res}'`
    );
  }
});

test("qc_only NO accede a recursos operativos (despacho, tickets, etc.)", () => {
  for (const res of OPS_RESOURCES) {
    assert.equal(
      roleAllows(["qc_only"], res),
      false,
      `qc_only NO debe acceder a '${res}'`
    );
  }
});

test("qc_only SOLO accede al muro QC", () => {
  assert.equal(roleAllows(["qc_only"], "qc_wall"), true);
  assert.deepEqual(allowedResources(["qc_only"]), ["qc_wall"]);
});

test("ops_coordinator accede a operación pero NO a finanzas ni nómina", () => {
  for (const res of OPS_RESOURCES) {
    assert.equal(roleAllows(["ops_coordinator"], res), true, `ops_coordinator debe acceder a '${res}'`);
  }
  assert.equal(roleAllows(["ops_coordinator"], "qc_wall"), true);
  for (const res of FINANCE_RESOURCES) {
    assert.equal(
      roleAllows(["ops_coordinator"], res),
      false,
      `ops_coordinator NO debe acceder a '${res}' (invariante: sin finanzas ni nómina)`
    );
  }
});

test("owner_admin accede a todo", () => {
  for (const res of [...FINANCE_RESOURCES, ...OPS_RESOURCES, "qc_wall" as AdminResource]) {
    assert.equal(roleAllows(["owner_admin"], res), true, `owner_admin debe acceder a '${res}'`);
  }
});

test("sin roles no se accede a nada", () => {
  for (const res of [...FINANCE_RESOURCES, ...OPS_RESOURCES, "qc_wall" as AdminResource]) {
    assert.equal(roleAllows([], res), false);
  }
});
