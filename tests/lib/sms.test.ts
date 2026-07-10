import { describe, it } from "node:test";
import assert from "node:assert";
import { sendPaymentUpdateSms, maskPhoneNumber, buildPaymentUpdateLink } from "../../src/lib/sms";

describe("maskPhoneNumber", () => {
  it("enmascara todo menos los ultimos 4 digitos", () => {
    assert.equal(maskPhoneNumber("+16045551234"), "***1234");
  });

  it("numeros muy cortos quedan totalmente enmascarados", () => {
    assert.equal(maskPhoneNumber("12"), "***");
  });
});

describe("buildPaymentUpdateLink", () => {
  it("construye el link sin doble slash", () => {
    const link = buildPaymentUpdateLink("order-123", "https://app.luluisland.com/");
    assert.equal(link, "https://app.luluisland.com/orders/order-123/update-payment");
  });
});

describe("sendPaymentUpdateSms", () => {
  it("sin proveedor configurado, devuelve status not_configured de forma deterministica (no lanza)", async () => {
    const result = await sendPaymentUpdateSms({
      orderId: "order-123",
      phoneNumber: "+16045551234",
      paymentLink: "https://app.luluisland.com/orders/order-123/update-payment",
    });
    assert.equal(result.status, "not_configured");
    assert.equal(result.maskedPhone, "***1234");
    assert.equal(result.providerResponse, null);
  });

  it("nunca incluye el telefono completo en el resultado (PIPA)", async () => {
    const result = await sendPaymentUpdateSms({
      orderId: "order-999",
      phoneNumber: "+16049998888",
      paymentLink: "https://app.luluisland.com/orders/order-999/update-payment",
    });
    assert.ok(!JSON.stringify(result).includes("+16049998888"));
  });
});
