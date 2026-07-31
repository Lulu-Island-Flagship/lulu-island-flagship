import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConsentRecord,
  recordConsent,
} from "../../src/lib/hiring-flow/consent-service";
import {
  LegalTextNotFoundError,
  UnrenderedPlaceholderError,
} from "../../src/lib/hiring-flow/legal-text-service";

// consent-service.buildConsentRecord accepts an injectable
// `renderLegalTextFn` parameter (default = the real renderLegalText). We
// use that instead of mocking the module import: mocking ESM imports of
// sibling files with the node:test runner (no jest/vi.mock available in
// this repo) is fragile, whereas passing a stub function is simple,
// explicit, and doesn't touch the module system at all.

function fakeRenderSuccess() {
  return async (key: string) => ({
    text: `Rendered text for ${key}`,
    version: "v2",
    textId: "11111111-1111-1111-1111-111111111111",
  });
}

function fakeRenderNotFound() {
  return async () => {
    throw new LegalTextNotFoundError("pipa_consent", "no_such_key");
  };
}

function fakeRenderUnresolvedPlaceholder() {
  return async () => {
    throw new UnrenderedPlaceholderError("pipa_consent", ["COMPANY_NAME"]);
  };
}

test("buildConsentRecord: builds a ConsentRecord from a successfully rendered legal text", async () => {
  const { record, renderedText } = await buildConsentRecord({
    candidateId: "cand-1",
    legalTextKey: "pipa_consent",
    accepted: true,
    ipAddress: "203.0.113.5",
    userAgent: "Mozilla/5.0",
    renderLegalTextFn: fakeRenderSuccess(),
  });

  assert.equal(renderedText, "Rendered text for pipa_consent");
  assert.deepEqual(record, {
    candidateId: "cand-1",
    legalTextKey: "pipa_consent",
    legalTextVersion: "v2",
    legalTextId: "11111111-1111-1111-1111-111111111111",
    accepted: true,
    ipAddress: "203.0.113.5",
    userAgent: "Mozilla/5.0",
  });
});

test("buildConsentRecord: legalTextVersion/legalTextId always come from renderLegalTextFn's response", async () => {
  // Sanity check that we're not somehow deriving version/id from anything
  // else (e.g. hardcoding or copying from params).
  const { record } = await buildConsentRecord({
    candidateId: "cand-2",
    legalTextKey: "terms_of_service",
    accepted: true,
    ipAddress: "198.51.100.9",
    userAgent: null,
    renderLegalTextFn: async () => ({
      text: "Some rendered text",
      version: "v7-final",
      textId: "22222222-2222-2222-2222-222222222222",
    }),
  });

  assert.equal(record.legalTextVersion, "v7-final");
  assert.equal(record.legalTextId, "22222222-2222-2222-2222-222222222222");
});

test("buildConsentRecord: propagates LegalTextNotFoundError when the legal text doesn't exist", async () => {
  await assert.rejects(
    () =>
      buildConsentRecord({
        candidateId: "cand-3",
        legalTextKey: "pipa_consent",
        accepted: true,
        ipAddress: "203.0.113.5",
        userAgent: null,
        renderLegalTextFn: fakeRenderNotFound(),
      }),
    LegalTextNotFoundError
  );
});

test("buildConsentRecord: propagates UnrenderedPlaceholderError when a placeholder is unresolved", async () => {
  await assert.rejects(
    () =>
      buildConsentRecord({
        candidateId: "cand-4",
        legalTextKey: "pipa_consent",
        accepted: true,
        ipAddress: "203.0.113.5",
        userAgent: null,
        renderLegalTextFn: fakeRenderUnresolvedPlaceholder(),
      }),
    UnrenderedPlaceholderError
  );
});

test("recordConsent: propagates the render error and never attempts an insert (no client -> insert would throw if reached)", async () => {
  // No `client` is provided and SUPABASE_SERVICE_ROLE_KEY is not set in
  // this test env, so insertConsent() would throw a distinct "not
  // configured" error if it were ever reached. Asserting we get the
  // LegalTextNotFoundError (not that other error) proves buildConsentRecord
  // failed BEFORE insertConsent was called.
  await assert.rejects(
    () =>
      recordConsent({
        candidateId: "cand-5",
        legalTextKey: "pipa_consent",
        accepted: true,
        ipAddress: "203.0.113.5",
        userAgent: null,
        renderLegalTextFn: fakeRenderNotFound(),
      }),
    LegalTextNotFoundError
  );
});

test("recordConsent: on success, builds the record and calls the provided client's insert, returning consentId", async () => {
  let insertedRow: Record<string, unknown> | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, "consents");
      return {
        insert(row: Record<string, unknown>) {
          insertedRow = row;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: "consent-abc-123" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const { consentId, renderedText } = await recordConsent({
    candidateId: "cand-6",
    legalTextKey: "pipa_consent",
    accepted: true,
    ipAddress: "203.0.113.5",
    userAgent: "Mozilla/5.0",
    client: fakeClient as any,
    renderLegalTextFn: fakeRenderSuccess(),
  });

  assert.equal(consentId, "consent-abc-123");
  assert.equal(renderedText, "Rendered text for pipa_consent");
  assert.ok(insertedRow);
  assert.equal((insertedRow as any).candidate_id, "cand-6");
  assert.equal((insertedRow as any).legal_text_version, "v2");
  assert.equal(
    (insertedRow as any).legal_text_id,
    "11111111-1111-1111-1111-111111111111"
  );
  assert.equal((insertedRow as any).accepted, true);
  assert.equal((insertedRow as any).ip_address, "203.0.113.5");
  assert.equal((insertedRow as any).user_agent, "Mozilla/5.0");
});
