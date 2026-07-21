/**
 * v8.3 E6.2 — Tests de telephony-router.ts (lógica pura, sin Supabase/Twilio).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  matchCallerToSchedule,
  buildInformResponse,
  detectAngerSignal,
  decideCallRouting,
  type DispatchMatrixEntry,
} from "../../src/lib/telephony-router";

const NOW = "2026-07-10T16:00:00.000Z";

function entry(overrides: Partial<DispatchMatrixEntry> = {}): DispatchMatrixEntry {
  return {
    orderId: "order-1",
    userId: "user-1",
    clientPhone: "+16045551234",
    serviceDatetimeIso: "2026-07-10T16:12:00.000Z", // 12 min después de NOW
    status: "pending",
    language: "fr",
    ...overrides,
  };
}

describe("matchCallerToSchedule", () => {
  it("encuentra la cita del día por número exacto", () => {
    const matrix = [entry()];
    const result = matchCallerToSchedule("+16045551234", matrix);
    assert.equal(result.matched, true);
    if (result.matched) assert.equal(result.entry.orderId, "order-1");
  });

  it("tolera formato sin '+1' / con espacios distintos (mismos dígitos)", () => {
    const matrix = [entry({ clientPhone: "16045551234" })];
    const result = matchCallerToSchedule("(604) 555-1234", matrix);
    assert.equal(result.matched, true);
  });

  it("no matchea un número que no está en la matriz de hoy", () => {
    const matrix = [entry()];
    const result = matchCallerToSchedule("+16045559999", matrix);
    assert.equal(result.matched, false);
    if (result.matched === false) assert.equal(result.reason, "no_matching_order_today");
  });

  it("rechaza un caller ID inválido (muy corto) sin reventar", () => {
    const result = matchCallerToSchedule("123", [entry()]);
    assert.equal(result.matched, false);
    if (result.matched === false) assert.equal(result.reason, "invalid_caller_phone");
  });

  it("con dos citas el mismo día, prioriza la abierta (no completed/cancelled) más próxima", () => {
    const matrix = [
      entry({ orderId: "closed-am", status: "completed", serviceDatetimeIso: "2026-07-10T08:00:00.000Z" }),
      entry({ orderId: "open-pm", status: "pending", serviceDatetimeIso: "2026-07-10T18:00:00.000Z" }),
    ];
    const result = matchCallerToSchedule("+16045551234", matrix);
    assert.equal(result.matched, true);
    if (result.matched) {
      assert.equal(result.entry.orderId, "open-pm");
      assert.equal(result.hadMultipleCandidates, true);
    }
  });

  it("si TODAS las citas del día están cerradas, devuelve la más reciente en vez de fallar", () => {
    const matrix = [
      entry({ orderId: "closed-1", status: "completed", serviceDatetimeIso: "2026-07-10T08:00:00.000Z" }),
      entry({ orderId: "closed-2", status: "cancelled", serviceDatetimeIso: "2026-07-10T10:00:00.000Z" }),
    ];
    const result = matchCallerToSchedule("+16045551234", matrix);
    assert.equal(result.matched, true);
    if (result.matched) assert.equal(result.entry.orderId, "closed-1");
  });
});

describe("buildInformResponse", () => {
  it("da el mensaje de ETA en francés cuando está dentro de la ventana razonable", () => {
    const match = matchCallerToSchedule("+16045551234", [entry()]);
    const res = buildInformResponse(match, "fr", NOW);
    assert.match(res.message, /12 minutes/);
    assert.equal(res.isAutomatedDisclosure, true);
  });

  it("da el mensaje de ETA en inglés cuando locale='en'", () => {
    const match = matchCallerToSchedule("+16045551234", [entry()]);
    const res = buildInformResponse(match, "en", NOW);
    assert.match(res.message, /12 minutes/);
  });

  it("no hay match: mensaje explícito de 'no encontrado' + enruta a humano en el mensaje", () => {
    const match = matchCallerToSchedule("+16045559999", [entry()]);
    const res = buildInformResponse(match, "fr", NOW);
    assert.match(res.message, /Nous n'avons trouvé aucun service/);
  });

  it("status completed da mensaje de completado, no un ETA inventado", () => {
    const match = matchCallerToSchedule("+16045551234", [entry({ status: "completed" })]);
    const res = buildInformResponse(match, "fr", NOW);
    assert.match(res.message, /déjà terminé/);
  });

  it("status arrived informa que el equipo ya llegó", () => {
    const match = matchCallerToSchedule("+16045551234", [entry({ status: "arrived" })]);
    const res = buildInformResponse(match, "fr", NOW);
    assert.match(res.message, /déjà arrivée/);
  });

  it("cita muy en el futuro (>180 min) da hora programada, no 'llega en 400 minutos'", () => {
    const match = matchCallerToSchedule("+16045551234", [
      entry({ serviceDatetimeIso: "2026-07-10T23:00:00.000Z" }),
    ]);
    const res = buildInformResponse(match, "fr", NOW);
    assert.match(res.message, /prévu pour/);
    assert.doesNotMatch(res.message, /minutes\./);
  });

  it("cita ya pasada y aún no arrancada: mensaje de retraso, no un ETA negativo", () => {
    const match = matchCallerToSchedule("+16045551234", [
      entry({ serviceDatetimeIso: "2026-07-10T15:00:00.000Z" }),
    ]);
    const res = buildInformResponse(match, "fr", NOW);
    assert.match(res.message, /du retard/);
  });

  it("todo mensaje incluye el prefijo de línea automatizada (nunca finge ser humano)", () => {
    const match = matchCallerToSchedule("+16045551234", [entry()]);
    const res = buildInformResponse(match, "fr", NOW);
    assert.match(res.message, /^Ligne automatisée\./);
  });
});

describe("detectAngerSignal", () => {
  it("detecta palabra clave de enojo en francés", () => {
    const result = detectAngerSignal({
      kind: "transcript",
      text: "c'est une arnaque, je veux parler à une personne",
      locale: "fr",
    });
    assert.equal(result.angerDetected, true);
  });

  it("no detecta enojo en un transcript neutral", () => {
    const result = detectAngerSignal({
      kind: "transcript",
      text: "bonjour, je veux savoir à quelle heure arrive mon équipe",
      locale: "fr",
    });
    assert.equal(result.angerDetected, false);
  });

  it("detecta palabra clave de enojo en inglés", () => {
    const result = detectAngerSignal({
      kind: "transcript",
      text: "this is unacceptable, I want to speak to a human",
      locale: "en",
    });
    assert.equal(result.angerDetected, true);
  });

  it("señal explícita de DTMF '0' siempre bypasea, sin importar el texto", () => {
    const result = detectAngerSignal({
      kind: "explicit_signal",
      signals: ["dtmf_0_requested_human"],
    });
    assert.equal(result.angerDetected, true);
  });

  it("señal explícita desconocida no bypasea (evita falsos positivos por strings arbitrarios)", () => {
    const result = detectAngerSignal({
      kind: "explicit_signal",
      signals: ["some_unrelated_signal"],
    });
    assert.equal(result.angerDetected, false);
  });
});

describe("decideCallRouting", () => {
  it("enojo detectado hace bypass inmediato a humano, incluso con match válido", () => {
    const decision = decideCallRouting({
      callerPhone: "+16045551234",
      todayDispatchMatrix: [entry()],
      angerInput: { kind: "transcript", text: "c'est terrible, je veux un humain", locale: "fr" },
      fallbackLocale: "en",
      nowIso: NOW,
    });
    assert.equal(decision.route, "human");
    assert.equal(decision.reason, "anger_detected");
    assert.equal(decision.angerDetected, true);
    assert.ok(decision.humanContext);
    assert.equal(decision.humanContext?.matchSummary?.includes("order-1"), true);
  });

  it("sin enojo y con match: resuelve sin humano (self_service) — cuenta para la meta ~80%", () => {
    const decision = decideCallRouting({
      callerPhone: "+16045551234",
      todayDispatchMatrix: [entry()],
      angerInput: { kind: "transcript", text: "bonjour merci", locale: "fr" },
      fallbackLocale: "en",
      nowIso: NOW,
    });
    assert.equal(decision.route, "self_service");
    assert.equal(decision.angerDetected, false);
    assert.equal(decision.humanContext, undefined);
  });

  it("sin enojo y SIN match: enruta a humano (el sistema no tiene con qué responder)", () => {
    const decision = decideCallRouting({
      callerPhone: "+16045559999",
      todayDispatchMatrix: [entry()],
      angerInput: { kind: "transcript", text: "bonjour", locale: "fr" },
      fallbackLocale: "en",
      nowIso: NOW,
    });
    assert.equal(decision.route, "human");
    assert.equal(decision.reason, "no_matching_order_today");
    assert.ok(decision.humanContext);
  });

  it("usa el idioma de la cuenta (entry.language), no el fallbackLocale, cuando hay match", () => {
    const decision = decideCallRouting({
      callerPhone: "+16045551234",
      todayDispatchMatrix: [entry({ language: "zh" })],
      angerInput: { kind: "transcript", text: "hi", locale: "en" },
      fallbackLocale: "en",
      nowIso: NOW,
    });
    assert.match(decision.response.message, /自动语音线路/);
  });

  it("usa el fallbackLocale cuando no hay match (no hay idioma de cuenta que consultar)", () => {
    const decision = decideCallRouting({
      callerPhone: "+16045559999",
      todayDispatchMatrix: [entry()],
      angerInput: { kind: "transcript", text: "hi", locale: "en" },
      fallbackLocale: "en",
      nowIso: NOW,
    });
    assert.match(decision.response.message, /^Automated line\./);
  });
});
