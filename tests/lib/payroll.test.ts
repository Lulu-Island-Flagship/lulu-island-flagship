import { describe, it } from "node:test";
import assert from "node:assert";
import { calculatePayroll, dollarsToCents, centsToDollars } from "../../src/lib/payroll";

describe("payroll", () => {
  describe("calculatePayroll", () => {
    it("returns base day rate with no adjustments", () => {
      const result = calculatePayroll({
        dayRate: dollarsToCents(150),
        estimatedServiceMinutes: 480,
      });

      assert.strictEqual(result.baseAmount, dollarsToCents(150));
      assert.strictEqual(result.qcBonusAmount, 0);
      assert.strictEqual(result.qcPenaltyAmount, 0);
      assert.strictEqual(result.reworkAmount, 0);
      assert.strictEqual(result.minimumWageAdjustment, 0);
      assert.strictEqual(result.grossAmount, dollarsToCents(150));
    });

    it("applies QC bonus above threshold", () => {
      const result = calculatePayroll({
        dayRate: dollarsToCents(150),
        estimatedServiceMinutes: 480,
        qcScore: 80,
        qcScoreThreshold: 70,
        qcBonusPerPoint: 100, // $1 per point
      });

      assert.strictEqual(result.qcBonusAmount, 1000); // 10 points * $1
      assert.strictEqual(result.grossAmount, dollarsToCents(160));
    });

    it("applies QC penalty below threshold and respects minimum wage", () => {
      const result = calculatePayroll({
        dayRate: dollarsToCents(150),
        estimatedServiceMinutes: 480,
        qcScore: 60,
        qcScoreThreshold: 70,
        qcPenaltyPerPoint: 50, // $0.50 per point
      });

      assert.strictEqual(result.qcPenaltyAmount, 500); // 10 points * $0.50
      // Con el penalty el equivalente cae bajo $18.25/hr, así que se ajusta al mínimo.
      assert.strictEqual(result.grossAmount, dollarsToCents(146));
      assert.ok(result.minimumWageAdjustment > 0);
    });

    it("caps rework at maxReworkMinutes", () => {
      const result = calculatePayroll({
        dayRate: dollarsToCents(150),
        estimatedServiceMinutes: 480,
        reworkMinutes: 60,
        maxReworkMinutes: 30,
      });

      assert.strictEqual(result.reworkPaidMinutes, 30);
      assert.ok(result.reworkAmount > 0);
    });

    it("applies BC minimum wage adjustment when hourly equivalent is below floor", () => {
      const result = calculatePayroll({
        dayRate: dollarsToCents(100), // $12.50/hr for 8h, below $18.25
        estimatedServiceMinutes: 480,
      });

      assert.ok(result.minimumWageAdjustment > 0);
      assert.ok(result.grossAmount >= dollarsToCents(146)); // 8h * $18.25
    });
  });

  describe("dollarsToCents / centsToDollars", () => {
    it("converts dollars to cents", () => {
      assert.strictEqual(dollarsToCents(18.25), 1825);
      assert.strictEqual(dollarsToCents(150), 15000);
    });

    it("converts cents to dollars", () => {
      assert.strictEqual(centsToDollars(1825), 18.25);
      assert.strictEqual(centsToDollars(15000), 150);
    });
  });
});
