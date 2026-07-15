import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateReEngagement,
  buildUnsubscribeLink,
  RE_ENGAGEMENT_UNOPENED_THRESHOLD,
  type MarketingLogEntry,
} from "../../src/lib/communication-preferences";

function entry(status: MarketingLogEntry["status"]): MarketingLogEntry {
  return { status, channel: "email", sentAt: "2026-07-01T00:00:00.000Z" };
}

describe("evaluateReEngagement", () => {
  it("no da de baja con historial vacío", () => {
    const r = evaluateReEngagement([]);
    assert.equal(r.shouldAutoUnsubscribe, false);
    assert.equal(r.consecutiveUnopenedCount, 0);
  });

  it("no da de baja con menos de 5 sin abrir", () => {
    const logs = [entry("sent"), entry("sent"), entry("delivered"), entry("sent")];
    const r = evaluateReEngagement(logs);
    assert.equal(r.consecutiveUnopenedCount, 4);
    assert.equal(r.shouldAutoUnsubscribe, false);
  });

  it("da de baja con exactamente 5 seguidos sin abrir", () => {
    const logs = [entry("sent"), entry("sent"), entry("delivered"), entry("sent"), entry("delivered")];
    const r = evaluateReEngagement(logs);
    assert.equal(r.consecutiveUnopenedCount, 5);
    assert.equal(r.shouldAutoUnsubscribe, true);
    assert.equal(RE_ENGAGEMENT_UNOPENED_THRESHOLD, 5);
  });

  it("una apertura reciente rompe la racha (no se da de baja)", () => {
    const logs = [entry("sent"), entry("sent"), entry("read"), entry("sent"), entry("sent"), entry("sent")];
    const r = evaluateReEngagement(logs);
    // los primeros 2 son sin abrir, luego 'read' detiene el conteo
    assert.equal(r.consecutiveUnopenedCount, 2);
    assert.equal(r.shouldAutoUnsubscribe, false);
  });

  it("'queued'/'postponed'/'failed' no cuentan como señal del cliente ni rompen la racha", () => {
    const logs = [entry("sent"), entry("queued"), entry("sent"), entry("postponed"), entry("sent"), entry("failed"), entry("sent"), entry("sent")];
    const r = evaluateReEngagement(logs);
    // 5 'sent' ignorando queued/postponed/failed (que no cuentan ni rompen la racha)
    assert.equal(r.consecutiveUnopenedCount, 5);
    assert.equal(r.shouldAutoUnsubscribe, true);
  });

  it("más de 5 sin abrir sigue dando de baja (no requiere ser EXACTO)", () => {
    const logs = Array(8).fill(null).map(() => entry("sent"));
    const r = evaluateReEngagement(logs);
    assert.equal(r.shouldAutoUnsubscribe, true);
  });
});

describe("buildUnsubscribeLink", () => {
  it("arma el link con el token", () => {
    const link = buildUnsubscribeLink("abc-123", "https://app.luluisland.ca");
    assert.equal(link, "https://app.luluisland.ca/api/communications/unsubscribe?token=abc-123");
  });

  it("normaliza una barra final en baseUrl", () => {
    const link = buildUnsubscribeLink("abc-123", "https://app.luluisland.ca/");
    assert.equal(link, "https://app.luluisland.ca/api/communications/unsubscribe?token=abc-123");
  });
});
