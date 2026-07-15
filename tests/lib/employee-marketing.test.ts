import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateEmployeeMarketingVisibility, canAdminApprove } from "../../src/lib/employee-marketing";

describe("evaluateEmployeeMarketingVisibility", () => {
  it("awaiting_consent si el empleado nunca consintió", () => {
    const v = evaluateEmployeeMarketingVisibility({
      employeeConsentedAt: null,
      employeeConsentWithdrawnAt: null,
      adminApprovedAt: null,
    });
    assert.equal(v, "not_visible_awaiting_consent");
  });

  it("awaiting_admin_approval si consintió pero no hay aprobación", () => {
    const v = evaluateEmployeeMarketingVisibility({
      employeeConsentedAt: "2026-07-01T00:00:00Z",
      employeeConsentWithdrawnAt: null,
      adminApprovedAt: null,
    });
    assert.equal(v, "not_visible_awaiting_admin_approval");
  });

  it("visible si consintió y admin aprobó", () => {
    const v = evaluateEmployeeMarketingVisibility({
      employeeConsentedAt: "2026-07-01T00:00:00Z",
      employeeConsentWithdrawnAt: null,
      adminApprovedAt: "2026-07-02T00:00:00Z",
    });
    assert.equal(v, "visible");
  });

  it("retiro de consentimiento gana incluso después de aprobado", () => {
    const v = evaluateEmployeeMarketingVisibility({
      employeeConsentedAt: "2026-07-01T00:00:00Z",
      employeeConsentWithdrawnAt: "2026-07-10T00:00:00Z",
      adminApprovedAt: "2026-07-02T00:00:00Z",
    });
    assert.equal(v, "not_visible_consent_withdrawn");
  });
});

describe("canAdminApprove", () => {
  it("no permite aprobar sin consentimiento", () => {
    const r = canAdminApprove({ employeeConsentedAt: null, employeeConsentWithdrawnAt: null, adminApprovedAt: null });
    assert.equal(r.allowed, false);
  });

  it("no permite aprobar si el consentimiento fue retirado", () => {
    const r = canAdminApprove({
      employeeConsentedAt: "2026-07-01T00:00:00Z",
      employeeConsentWithdrawnAt: "2026-07-05T00:00:00Z",
      adminApprovedAt: null,
    });
    assert.equal(r.allowed, false);
  });

  it("permite aprobar con consentimiento vigente", () => {
    const r = canAdminApprove({
      employeeConsentedAt: "2026-07-01T00:00:00Z",
      employeeConsentWithdrawnAt: null,
      adminApprovedAt: null,
    });
    assert.equal(r.allowed, true);
  });
});
