import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeRotationStatus,
  detectPairingExceptionViolations,
  MIN_DISTINCT_COWORKERS_PER_MONTH,
  type AssignmentPair,
  type PairingException,
} from "../../src/lib/coworker-rotation";

function pair(a: string, b: string, orderId: string): AssignmentPair {
  return { employeeAId: a, employeeBId: b, orderId, serviceDate: "2026-07-01" };
}

describe("computeRotationStatus", () => {
  it("compliant con exactamente 3 compañeros distintos", () => {
    const pairs = [pair("e1", "e2", "o1"), pair("e1", "e3", "o2"), pair("e1", "e4", "o3")];
    const status = computeRotationStatus(pairs);
    const e1 = status.find((s) => s.employeeId === "e1")!;
    assert.equal(e1.distinctCount, 3);
    assert.equal(e1.compliant, true);
    assert.equal(MIN_DISTINCT_COWORKERS_PER_MONTH, 3);
  });

  it("no compliant con menos de 3", () => {
    const pairs = [pair("e1", "e2", "o1"), pair("e1", "e3", "o2")];
    const status = computeRotationStatus(pairs);
    const e1 = status.find((s) => s.employeeId === "e1")!;
    assert.equal(e1.distinctCount, 2);
    assert.equal(e1.compliant, false);
  });

  it("el mismo compañero repetido varias veces no cuenta doble", () => {
    const pairs = [pair("e1", "e2", "o1"), pair("e1", "e2", "o2"), pair("e1", "e2", "o3")];
    const status = computeRotationStatus(pairs);
    const e1 = status.find((s) => s.employeeId === "e1")!;
    assert.equal(e1.distinctCount, 1);
    assert.equal(e1.compliant, false);
  });

  it("cuenta simétricamente para ambos lados del par", () => {
    const pairs = [pair("e1", "e2", "o1")];
    const status = computeRotationStatus(pairs);
    const e1 = status.find((s) => s.employeeId === "e1")!;
    const e2 = status.find((s) => s.employeeId === "e2")!;
    assert.deepEqual(e1.distinctCoworkerIds, ["e2"]);
    assert.deepEqual(e2.distinctCoworkerIds, ["e1"]);
  });

  it("lista vacía produce estado vacío", () => {
    assert.deepEqual(computeRotationStatus([]), []);
  });
});

describe("detectPairingExceptionViolations", () => {
  it("detecta violación cuando un par excepcionado sí trabajó junto", () => {
    const pairs = [pair("e1", "e2", "o1")];
    const exceptions: PairingException[] = [{ employeeAId: "e1", employeeBId: "e2", reason: "Conflicto histórico" }];
    const violations = detectPairingExceptionViolations(pairs, exceptions);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].orderIds.length, 1);
  });

  it("detecta la violación sin importar el orden del par (A,B) vs (B,A)", () => {
    const pairs = [pair("e2", "e1", "o1")];
    const exceptions: PairingException[] = [{ employeeAId: "e1", employeeBId: "e2", reason: "x" }];
    const violations = detectPairingExceptionViolations(pairs, exceptions);
    assert.equal(violations.length, 1);
  });

  it("sin violación si el par excepcionado nunca coincidió", () => {
    const pairs = [pair("e1", "e3", "o1")];
    const exceptions: PairingException[] = [{ employeeAId: "e1", employeeBId: "e2", reason: "x" }];
    const violations = detectPairingExceptionViolations(pairs, exceptions);
    assert.equal(violations.length, 0);
  });

  it("agrupa múltiples órdenes del mismo par violado", () => {
    const pairs = [pair("e1", "e2", "o1"), pair("e1", "e2", "o2")];
    const exceptions: PairingException[] = [{ employeeAId: "e1", employeeBId: "e2", reason: "x" }];
    const violations = detectPairingExceptionViolations(pairs, exceptions);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].orderIds.length, 2);
  });
});
