import { describe, it } from "node:test";
import assert from "node:assert";
import { maskEmail, sendEmail } from "../../src/lib/email";

describe("maskEmail", () => {
  it("conserva la primera letra del local-part y el dominio completo", () => {
    assert.equal(maskEmail("julian.yepes@example.com"), "j***@example.com");
  });

  it("maneja local-parts de una sola letra", () => {
    assert.equal(maskEmail("a@example.com"), "a***@example.com");
  });

  it("devuelve *** si no hay @ (input inválido, nunca lanza)", () => {
    assert.equal(maskEmail("not-an-email"), "***");
  });
});

describe("sendEmail", () => {
  it("nunca intenta red: siempre resuelve 'not_configured' mientras no haya proveedor", async () => {
    const result = await sendEmail({
      toEmail: "cliente@example.com",
      subject: "Tu servicio de hoy",
      body: "Hola, tu equipo llega en 15 minutos.",
    });
    assert.equal(result.status, "not_configured");
    assert.equal(result.maskedEmail, "c***@example.com");
    assert.equal(result.providerResponse, null);
  });

  it("nunca lanza excepción, incluso con input raro", async () => {
    await assert.doesNotReject(() => sendEmail({ toEmail: "", subject: "", body: "" }));
  });
});
