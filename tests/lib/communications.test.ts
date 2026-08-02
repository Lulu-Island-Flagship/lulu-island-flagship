/**
 * v8.3 E6 — Tests del motor de comunicaciones.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  renderTemplate,
  arbitrateThrottle,
  MissingVariableError,
  type ProposedMessage,
} from "../../src/lib/communications";

describe("renderTemplate", () => {
  it("sustituye variables", () => {
    assert.equal(
      renderTemplate("Hola {nombre}, tu equipo llega en {eta} min", { nombre: "Ana", eta: 12 }),
      "Hola Ana, tu equipo llega en 12 min"
    );
  });

  it("FALLA ruidosamente si falta una variable (nunca enviar {placeholder} literal)", () => {
    assert.throws(
      () => renderTemplate("Hola {nombre}, llega {eta}", { nombre: "Ana" }),
      MissingVariableError
    );
  });

  it("reporta TODAS las variables faltantes de una vez", () => {
    try {
      renderTemplate("{a} {b} {a}", {});
      assert.fail("debió lanzar");
    } catch (e) {
      assert.deepEqual((e as MissingVariableError).missing, ["a", "b"]);
    }
  });

  it("NO escapa HTML en variables -- los 3 consumidores actuales son texto plano", () => {
    // Decisión documentada (ver comentario sobre renderTemplate en
    // communications.ts, revertido 2026-08-02): SMS y el `text:` de Resend
    // son texto plano, y OrderCommunicationTimeline.tsx renderiza el
    // resultado como children de JSX (React ya escapa solo, sin
    // dangerouslySetInnerHTML). Escapar acá corrompería mensajes reales con
    // apóstrofe/&/comillas (ej. "O'Brien" -> "O&#39;Brien" en un SMS de
    // verdad) sin cerrar ninguna vulnerabilidad real. Si algún consumidor
    // futuro SÍ renderiza este output como HTML, el escape debe vivir en ESE
    // punto de salida, no acá -- y este test debe borrarse/actualizarse
    // junto con ese cambio, no antes.
    assert.equal(
      renderTemplate("Hola {nombre}", { nombre: "O'Brien & Sons <VIP>" }),
      "Hola O'Brien & Sons <VIP>"
    );
  });
});

const msg = (over: Partial<ProposedMessage>): ProposedMessage => ({
  id: Math.random().toString(36).slice(2),
  userId: "u1",
  eventKey: "x",
  category: "marketing",
  priority: "normal",
  ...over,
});

describe("arbitrateThrottle (M13 F13.3)", () => {
  it("urgentes y transaccionales NUNCA se retrasan", () => {
    const r = arbitrateThrottle(
      [
        msg({ category: "transactional", eventKey: "team_en_route", priority: "urgent" }),
        msg({ category: "transactional", eventKey: "service_completed" }),
      ],
      new Set(["u1"]) // aunque ya recibió marketing esta semana
    );
    assert.equal(r.send.length, 2);
    assert.equal(r.postponed.length, 0);
  });

  it("trigger físico y campaña la MISMA semana: gana el de mayor peso, el otro se pospone", () => {
    const fisico = msg({ eventKey: "retention_trigger", marketingWeight: 10 });
    const campana = msg({ eventKey: "winback_day1", marketingWeight: 5 });
    const r = arbitrateThrottle([fisico, campana], new Set());
    assert.equal(r.send.length, 1);
    assert.equal(r.send[0].eventKey, "retention_trigger");
    assert.equal(r.postponed.length, 1);
    assert.equal(r.postponed[0].message.eventKey, "winback_day1");
  });

  it("usuario que YA recibió marketing esta semana no recibe más", () => {
    const r = arbitrateThrottle([msg({ eventKey: "birthday_gift" })], new Set(["u1"]));
    assert.equal(r.send.length, 0);
    assert.equal(r.postponed.length, 1);
    assert.match(r.postponed[0].reason, /ya recibió marketing/);
  });

  it("usuarios distintos no se bloquean entre sí", () => {
    const r = arbitrateThrottle(
      [msg({ userId: "u1", eventKey: "a" }), msg({ userId: "u2", eventKey: "b" })],
      new Set()
    );
    assert.equal(r.send.length, 2);
  });
});
