import { describe, it } from "node:test";
import assert from "node:assert";
import { requestSignature } from "../../src/lib/esignature-provider";

describe("requestSignature", () => {
  it("devuelve not_configured de forma determinista (sin proveedor contratado)", async () => {
    const result = await requestSignature({
      documentType: "client_terms",
      signerName: "Jane Doe",
      signerEmail: "jane@example.com",
      documentContent: "T&C content",
    });
    assert.equal(result.status, "not_configured");
    assert.equal(result.providerEnvelopeId, null);
    assert.equal(result.providerResponse, null);
  });

  it("nunca lanza, incluso con inputs mínimos", async () => {
    await assert.doesNotReject(
      requestSignature({
        documentType: "employment_contract",
        signerName: "",
        signerEmail: "",
        documentContent: "",
      })
    );
  });
});
