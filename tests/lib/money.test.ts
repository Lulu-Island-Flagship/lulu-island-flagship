import { describe, it } from "node:test";
import assert from "node:assert";
import {
  parseDollarsToCents,
  dollarsToCentsExact,
  centsToDollarsString,
  centsToDollarsNumber,
  gstFromBaseCents,
  pstFromBaseCents,
  roundHalfUp,
} from "../../src/lib/money";
import { computeTaxBreakdown, dollarsToCents, centsToDollars } from "../../src/lib/pricing";

describe("money (unidades enteras exactas)", () => {
  describe("parseDollarsToCents", () => {
    it("convierte dólares decimales exactos a centavos", () => {
      assert.strictEqual(parseDollarsToCents("19.99"), 1999n);
      assert.strictEqual(parseDollarsToCents("0.1"), 10n);
      assert.strictEqual(parseDollarsToCents("250.00"), 25000n);
      assert.strictEqual(parseDollarsToCents("0"), 0n);
      assert.strictEqual(parseDollarsToCents("100"), 10000n);
    });

    it("redondea medio-arriba en el tercer decimal", () => {
      assert.strictEqual(parseDollarsToCents("0.005"), 1n); // 0.005 → 0.01
      assert.strictEqual(parseDollarsToCents("1.005"), 101n); // 1.005 → 1.01
      assert.strictEqual(parseDollarsToCents("0.004"), 0n); // 0.004 → 0.00
    });

    it("maneja negativos (signo fuera de la magnitud)", () => {
      assert.strictEqual(parseDollarsToCents("-3.50"), -350n);
    });

    it("rechaza entradas inválidas", () => {
      assert.throws(() => parseDollarsToCents("abc"));
      assert.throws(() => parseDollarsToCents(".5"));
    });
  });

  describe("dollarsToCentsExact", () => {
    it("evita el error de punto flotante de amount*100", () => {
      // 0.1 + 0.2 = 0.30000000000000004 en float; la lectura decimal es 0.30
      assert.strictEqual(dollarsToCentsExact(0.1 + 0.2), 30n);
      assert.strictEqual(dollarsToCentsExact(19.99), 1999n);
      assert.strictEqual(dollarsToCentsExact(1.005), 101n);
    });
  });

  describe("centsToDollarsString / centsToDollarsNumber", () => {
    it("formatea sin pérdida", () => {
      assert.strictEqual(centsToDollarsString(1999n), "19.99");
      assert.strictEqual(centsToDollarsString(5n), "0.05");
      assert.strictEqual(centsToDollarsString(0n), "0.00");
      assert.strictEqual(centsToDollarsString(-150n), "-1.50");
    });

    it("convierte a number para persistencia", () => {
      assert.strictEqual(centsToDollarsNumber(1999n), 19.99);
      assert.strictEqual(centsToDollarsNumber(15000), 150);
    });
  });

  describe("gstFromBaseCents / pstFromBaseCents", () => {
    it("calcula GST/PST con aritmética entera exacta", () => {
      assert.strictEqual(gstFromBaseCents(1999n), 100n); // 19.99 * 5% = 0.9995 → 1.00
      assert.strictEqual(pstFromBaseCents(1999n), 140n); // 19.99 * 7% = 1.3993 → 1.40
      assert.strictEqual(gstFromBaseCents(10n), 1n); // 0.10 * 5% = 0.005 → 0.01 (half up)
      assert.strictEqual(gstFromBaseCents(1n), 0n);
    });
  });

  describe("roundHalfUp", () => {
    it("redondea medio arriba con división entera", () => {
      assert.strictEqual(roundHalfUp(5n, 100n), 0n);
      assert.strictEqual(roundHalfUp(50n, 100n), 1n); // 0.50 → 1
      assert.strictEqual(roundHalfUp(149n, 100n), 1n);
      assert.strictEqual(roundHalfUp(150n, 100n), 2n); // 1.50 → 2
    });
  });

  describe("computeTaxBreakdown (backward compatible)", () => {
    it("mantiene subtotal + gst + pst === total", () => {
      const b = computeTaxBreakdown(19.99);
      assert.strictEqual(b.subtotal, 19.99);
      assert.strictEqual(b.gst, 1.0);
      assert.strictEqual(b.pst, 1.4);
      assert.strictEqual(b.total, 22.39);
      assert.ok(Math.abs(b.subtotal + b.gst + b.pst - b.total) < 1e-9);
    });

    it("clampa subtotales negativos a cero", () => {
      const b = computeTaxBreakdown(-5);
      assert.strictEqual(b.subtotal, 0);
      assert.strictEqual(b.total, 0);
    });

    it("calcula sobre valores redondos", () => {
      const b = computeTaxBreakdown(100);
      assert.strictEqual(b.gst, 5);
      assert.strictEqual(b.pst, 7);
      assert.strictEqual(b.total, 112);
    });
  });

  describe("dollarsToCents / centsToDollars (compat number)", () => {
    it("mantiene la API number→number", () => {
      assert.strictEqual(dollarsToCents(18.25), 1825);
      assert.strictEqual(dollarsToCents(150), 15000);
      assert.strictEqual(centsToDollars(1825), 18.25);
    });
  });
});
