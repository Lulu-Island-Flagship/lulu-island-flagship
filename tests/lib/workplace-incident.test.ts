import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeWorkSafeBCDeadline,
  computeWorkSafeBCReportStatus,
  buildPrefilledReportFields,
  WORKSAFEBC_REPORT_DEADLINE_HOURS,
} from "../../src/lib/workplace-incident";

describe("computeWorkSafeBCDeadline", () => {
  it("suma exactamente 72h al incidente", () => {
    const deadline = computeWorkSafeBCDeadline("2026-07-10T09:00:00.000Z");
    assert.equal(deadline, "2026-07-13T09:00:00.000Z");
    assert.equal(WORKSAFEBC_REPORT_DEADLINE_HOURS, 72);
  });
});

describe("computeWorkSafeBCReportStatus", () => {
  const DUE = "2026-07-13T09:00:00.000Z";

  it("pending si falta más de 24h y no se ha presentado", () => {
    const status = computeWorkSafeBCReportStatus({ dueAtIso: DUE, filedAtIso: null, nowIso: "2026-07-11T09:00:00.000Z" });
    assert.equal(status, "pending");
  });

  it("due_soon si faltan 24h o menos", () => {
    const status = computeWorkSafeBCReportStatus({ dueAtIso: DUE, filedAtIso: null, nowIso: "2026-07-12T10:00:00.000Z" });
    assert.equal(status, "due_soon");
  });

  it("overdue si ya pasó el plazo y no se presentó", () => {
    const status = computeWorkSafeBCReportStatus({ dueAtIso: DUE, filedAtIso: null, nowIso: "2026-07-14T00:00:00.000Z" });
    assert.equal(status, "overdue");
  });

  it("filed_on_time si se presentó antes o justo en el plazo", () => {
    const status = computeWorkSafeBCReportStatus({ dueAtIso: DUE, filedAtIso: "2026-07-12T09:00:00.000Z", nowIso: "2026-07-20T00:00:00.000Z" });
    assert.equal(status, "filed_on_time");
  });

  it("filed_on_time si se presentó exactamente en el plazo", () => {
    const status = computeWorkSafeBCReportStatus({ dueAtIso: DUE, filedAtIso: DUE, nowIso: "2026-07-20T00:00:00.000Z" });
    assert.equal(status, "filed_on_time");
  });

  it("filed_late si se presentó después del plazo", () => {
    const status = computeWorkSafeBCReportStatus({ dueAtIso: DUE, filedAtIso: "2026-07-14T00:00:00.000Z", nowIso: "2026-07-20T00:00:00.000Z" });
    assert.equal(status, "filed_late");
  });

  it("un estado 'filed' es terminal aunque 'now' sea mucho después", () => {
    const status = computeWorkSafeBCReportStatus({ dueAtIso: DUE, filedAtIso: "2026-07-12T09:00:00.000Z", nowIso: "2030-01-01T00:00:00.000Z" });
    assert.equal(status, "filed_on_time");
  });
});

describe("buildPrefilledReportFields", () => {
  it("arma los campos a partir de lo que el sistema conoce, sin inventar datos del empleador", () => {
    const fields = buildPrefilledReportFields({
      employeeName: "Jane Doe",
      incidentDatetimeIso: "2026-07-10T15:30:00.000Z",
      locationDescription: "Cliente en Steveston",
      bodyPartAffected: "Mano izquierda",
      injuryDescription: "Corte con vidrio roto",
      medicalAttentionType: "first_aid",
      witnesses: null,
      immediateActionTaken: null,
    });
    assert.equal(fields.workerName, "Jane Doe");
    assert.equal(fields.dateOfInjury, "2026-07-10");
    assert.equal(fields.timeOfInjury, "15:30");
    assert.equal(fields.medicalAttention, "Primeros auxilios en sitio");
    assert.equal(fields.witnesses, "(ninguno registrado)");
    assert.ok(fields.guidanceNote.toLowerCase().includes("no admitir culpa"));
    assert.equal(fields.reportingDeadline, "2026-07-13T15:30:00.000Z");
  });
});
