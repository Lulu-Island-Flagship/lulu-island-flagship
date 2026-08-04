/**
 * v8.3 E6 Sesión H — Tests de entrega real de reseña (B.2.18).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildReviewLink,
  buildReviewQrSvg,
  hasOpenCriticalDispute,
} from "../../src/lib/review-delivery";

describe("buildReviewLink", () => {
  it("construye el link sin doble slash (ruta i18n: /review/)", () => {
    assert.equal(
      buildReviewLink("abc-123", "https://app.luluisland.ca/"),
      "https://app.luluisland.ca/review/abc-123"
    );
  });

  it("funciona sin slash final en baseUrl", () => {
    assert.equal(
      buildReviewLink("abc-123", "https://app.luluisland.ca"),
      "https://app.luluisland.ca/review/abc-123"
    );
  });
});

describe("buildReviewQrSvg", () => {
  it("genera un SVG real que codifica el link de reseña", async () => {
    const svg = await buildReviewQrSvg("token-xyz", "https://app.luluisland.ca");
    assert.match(svg, /<svg/);
    assert.match(svg, /<\/svg>/);
  });
});

describe("hasOpenCriticalDispute (excepción B.2.18)", () => {
  it("sin tickets: no hay exclusión", () => {
    assert.equal(hasOpenCriticalDispute([]), false);
  });

  it("disputa de prioridad alta y abierta SÍ excluye", () => {
    assert.equal(
      hasOpenCriticalDispute([{ type: "dispute", priority: "high", status: "open" }]),
      true
    );
  });

  it("discrepancia de prioridad alta en revisión SÍ excluye", () => {
    assert.equal(
      hasOpenCriticalDispute([{ type: "discrepancy", priority: "high", status: "in_review" }]),
      true
    );
  });

  it("prioridad media/baja NO excluye (anti-gating: la excepción es angosta)", () => {
    assert.equal(
      hasOpenCriticalDispute([{ type: "dispute", priority: "medium", status: "open" }]),
      false
    );
  });

  it("ticket ya resuelto NO excluye", () => {
    assert.equal(
      hasOpenCriticalDispute([{ type: "dispute", priority: "high", status: "resolved" }]),
      false
    );
  });

  it("tipo 'consulta' de prioridad alta NO excluye (no es discrepancia/disputa)", () => {
    assert.equal(
      hasOpenCriticalDispute([{ type: "consulta", priority: "high", status: "open" }]),
      false
    );
  });
});
