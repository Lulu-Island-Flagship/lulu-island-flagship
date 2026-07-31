import { test } from "node:test";
import assert from "node:assert/strict";
import { recordClientConsent } from "../../src/lib/client-module/client-consent-service";
import {
  LegalTextNotFoundError,
  UnrenderedPlaceholderError,
} from "../../src/lib/hiring-flow/legal-text-service";

// recordClientConsent accepts an injectable `renderLegalTextFn` parameter
// (default = the real renderLegalText from hiring-flow/legal-text-service).
// Same pattern as hiring-flow/consent-service.ts and
// hiring-flow-consent-service.test.ts: we inject a stub instead of mocking
// the ESM module import.

function fakeRenderSuccess() {
  return async (key: string) => ({
    text: `Rendered text for ${key}`,
    version: "v3",
    textId: "33333333-3333-3333-3333-333333333333",
  });
}

function fakeRenderNotFound() {
  return async () => {
    throw new LegalTextNotFoundError("service_agreement", "no_such_key");
  };
}

function fakeRenderUnresolvedPlaceholder() {
  return async () => {
    throw new UnrenderedPlaceholderError("service_agreement", ["COMPANY_NAME"]);
  };
}

test("recordClientConsent: on success, inserts using version/id from renderLegalTextFn and returns consentId + renderedText", async () => {
  let insertedRow: Record<string, unknown> | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "client_consents");
      return {
        insert(row: Record<string, unknown>) {
          insertedRow = row;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "consent-xyz-1" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const { consentId, renderedText } = await recordClientConsent({
    clientId: "client-1",
    consentType: "service_agreement",
    legalTextKey: "service_agreement",
    accepted: true,
    ipAddress: "203.0.113.5",
    userAgent: "Mozilla/5.0",
    client: fakeClient as any,
    renderLegalTextFn: fakeRenderSuccess(),
  });

  assert.equal(consentId, "consent-xyz-1");
  assert.equal(renderedText, "Rendered text for service_agreement");
  assert.ok(insertedRow);
  assert.equal((insertedRow as any).client_id, "client-1");
  assert.equal((insertedRow as any).consent_type, "service_agreement");
  assert.equal((insertedRow as any).legal_text_version, "v3");
  assert.equal(
    (insertedRow as any).legal_text_id,
    "33333333-3333-3333-3333-333333333333"
  );
  assert.equal((insertedRow as any).accepted, true);
  assert.equal((insertedRow as any).ip_address, "203.0.113.5");
  assert.equal((insertedRow as any).user_agent, "Mozilla/5.0");
});

test("recordClientConsent: propagates LegalTextNotFoundError and never attempts an insert", async () => {
  let fromCalled = false;
  const fakeClient = {
    from() {
      fromCalled = true;
      throw new Error("insert should never be reached when render fails");
    },
  };

  await assert.rejects(
    () =>
      recordClientConsent({
        clientId: "client-2",
        consentType: "pipa_consent",
        legalTextKey: "pipa_consent",
        accepted: true,
        ipAddress: "203.0.113.5",
        userAgent: null,
        client: fakeClient as any,
        renderLegalTextFn: fakeRenderNotFound(),
      }),
    LegalTextNotFoundError
  );
  assert.equal(fromCalled, false);
});

test("recordClientConsent: propagates UnrenderedPlaceholderError and never attempts an insert", async () => {
  let fromCalled = false;
  const fakeClient = {
    from() {
      fromCalled = true;
      throw new Error("insert should never be reached when render fails");
    },
  };

  await assert.rejects(
    () =>
      recordClientConsent({
        clientId: "client-3",
        consentType: "service_agreement",
        legalTextKey: "service_agreement",
        accepted: true,
        ipAddress: "203.0.113.5",
        userAgent: null,
        client: fakeClient as any,
        renderLegalTextFn: fakeRenderUnresolvedPlaceholder(),
      }),
    UnrenderedPlaceholderError
  );
  assert.equal(fromCalled, false);
});
