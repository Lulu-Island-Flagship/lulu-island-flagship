/**
 * v8.3 E6 Sesión H — Tests del motor de despacho de comunicaciones.
 * decideDispatch es pura: prueba que arbitrateThrottle (ya testeado en
 * communications.test.ts) está REALMENTE en el camino de los nuevos
 * disparadores, y que un evento desactivado o una plantilla con variables
 * faltantes nunca produce un envío silencioso.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  decideDispatch,
  vancouverWeekStartIso,
  type CommunicationEventRow,
} from "../../src/lib/send-communication";

const transactionalEvent: CommunicationEventRow = {
  event_key: "service_completed",
  category: "transactional",
  priority: "normal",
  default_channel: "sms",
  is_active: true,
};

const marketingEvent: CommunicationEventRow = {
  event_key: "retention_trigger",
  category: "marketing",
  priority: "normal",
  default_channel: "sms",
  is_active: true,
};

describe("decideDispatch", () => {
  it("envía un transaccional activo con todas las variables presentes", () => {
    const result = decideDispatch({
      event: transactionalEvent,
      template: { body: "Hola {client_name}, tu servicio terminó.", language: "es" },
      vars: { client_name: "Ana" },
      userId: "u1",
      eventKey: "service_completed",
      marketingSentThisWeek: false,
    });
    assert.equal(result.action, "send");
    if (result.action === "send") {
      assert.equal(result.renderedBody, "Hola Ana, tu servicio terminó.");
      assert.equal(result.channel, "sms");
    }
  });

  it("renderiza el subject con las mismas vars cuando el canal es email y la plantilla trae subject", () => {
    const result = decideDispatch({
      event: { ...transactionalEvent, default_channel: "email" },
      template: { body: "Hola {client_name}.", language: "es", subject: "Recibo de {client_name}" },
      vars: { client_name: "Ana" },
      userId: "u1",
      eventKey: "service_completed",
      marketingSentThisWeek: false,
    });
    assert.equal(result.action, "send");
    if (result.action === "send") {
      assert.equal(result.renderedSubject, "Recibo de Ana");
      assert.equal(result.channel, "email");
    }
  });

  it("renderedSubject es null cuando la plantilla no trae subject", () => {
    const result = decideDispatch({
      event: transactionalEvent,
      template: { body: "Hola {client_name}", language: "es" },
      vars: { client_name: "Ana" },
      userId: "u1",
      eventKey: "service_completed",
      marketingSentThisWeek: false,
    });
    assert.equal(result.action, "send");
    if (result.action === "send") {
      assert.equal(result.renderedSubject, null);
    }
  });

  it("evento desactivado nunca envía (falla explícitamente, no silenciosamente)", () => {
    const result = decideDispatch({
      event: { ...transactionalEvent, is_active: false },
      template: { body: "Hola {client_name}", language: "es" },
      vars: { client_name: "Ana" },
      userId: "u1",
      eventKey: "service_completed",
      marketingSentThisWeek: false,
    });
    assert.equal(result.action, "failed");
  });

  it("variable faltante en la plantilla falla, nunca envía {placeholder} literal", () => {
    const result = decideDispatch({
      event: transactionalEvent,
      template: { body: "Hola {client_name}, tu link: {gallery_link}", language: "es" },
      vars: { client_name: "Ana" },
      userId: "u1",
      eventKey: "service_completed",
      marketingSentThisWeek: false,
    });
    assert.equal(result.action, "failed");
    if (result.action === "failed") {
      assert.match(result.reason, /gallery_link/);
    }
  });

  it("marketing pospuesto si el usuario YA recibió marketing esta semana (arbitrateThrottle real)", () => {
    const result = decideDispatch({
      event: marketingEvent,
      template: { body: "Oferta para {client_name}", language: "es" },
      vars: { client_name: "Ana" },
      userId: "u1",
      eventKey: "retention_trigger",
      marketingSentThisWeek: true,
    });
    assert.equal(result.action, "postpone");
    if (result.action === "postpone") {
      assert.match(result.reason, /ya recibió marketing/);
    }
  });

  it("transaccional NUNCA se pospone aunque el usuario ya recibió marketing esta semana", () => {
    const result = decideDispatch({
      event: transactionalEvent,
      template: { body: "Hola {client_name}", language: "es" },
      vars: { client_name: "Ana" },
      userId: "u1",
      eventKey: "service_completed",
      marketingSentThisWeek: true,
    });
    assert.equal(result.action, "send");
  });

  it("marketing se envía si el usuario no ha recibido marketing esta semana", () => {
    const result = decideDispatch({
      event: marketingEvent,
      template: { body: "Oferta para {client_name}", language: "es" },
      vars: { client_name: "Ana" },
      userId: "u1",
      eventKey: "retention_trigger",
      marketingSentThisWeek: false,
    });
    assert.equal(result.action, "send");
  });
});

describe("vancouverWeekStartIso", () => {
  it("un miércoles retrocede al lunes de esa semana", () => {
    // 2026-07-08 es miércoles
    const monday = vancouverWeekStartIso("2026-07-08");
    assert.equal(monday.slice(0, 10), "2026-07-06"); // lunes
  });

  it("un lunes se queda en el mismo día", () => {
    const monday = vancouverWeekStartIso("2026-07-06");
    assert.equal(monday.slice(0, 10), "2026-07-06");
  });

  it("un domingo retrocede al lunes anterior", () => {
    const monday = vancouverWeekStartIso("2026-07-12");
    assert.equal(monday.slice(0, 10), "2026-07-06");
  });
});
