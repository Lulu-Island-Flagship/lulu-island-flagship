import { test } from "node:test";
import assert from "node:assert/strict";
import {
  submitStep1Application,
  Step1SubmissionError,
  ConsentRequiredError,
} from "../../src/lib/hiring-flow/candidate-step1-service";
import { PositionNotFoundError } from "../../src/lib/hiring-flow/positions-service";
import type { Step1Input, Step1ValidationError } from "../../src/lib/hiring-flow/step1-validator";

// ---------------------------------------------------------------------------
// submitStep1Application depende de módulos escritos por otros agentes
// (positions-service es propio; access-code-service, step1-validator y
// legal-text-service son de otros). Todas las dependencias son
// inyectables (mismo patrón que consent-service.ts / renderLegalTextFn),
// así que estos tests mockean directamente esas funciones inyectadas y
// nunca dependen de un cliente Supabase real.
//
// Desde el fix de atomicidad (supabase/migrations/
// 268_hiring_flow_submit_step1_atomic.sql), la inserción de candidato +
// consentimiento ya no es un saga con compensación (insertCandidateFn +
// recordConsentFn + deleteCandidateFn por separado) -- es una sola función
// inyectable, insertCandidateWithConsentFn, que representa la llamada
// atómica a la RPC submit_step1_candidate. Por eso ya no existen tests de
// "compensación exitosa" ni de OrphanedCandidateError: esa clase de error
// ya no puede ocurrir, porque Postgres garantiza que candidates + consents
// se insertan juntos o ninguno de los dos.
// ---------------------------------------------------------------------------

const VALID_INPUT: Step1Input = {
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "6045550123",
  dateOfBirth: "2000-01-01",
};

function makeFakeClient() {
  return {} as any;
}

function makeCallLog() {
  return {
    calls: [] as string[],
    push(name: string) {
      this.calls.push(name);
    },
  };
}

test("submitStep1Application: happy path -- renders legal text, inserts candidate+consent atomically, issues code, logs funnel event", async () => {
  const log = makeCallLog();
  const client = makeFakeClient();

  const result = await submitStep1Application({
    positionSlug: "recepcionista-2026",
    input: VALID_INPUT,
    ipAddress: "1.2.3.4",
    userAgent: "test-agent",
    consentAccepted: true,
    client,
    getPublicPositionFn: async (slug) => {
      log.push("getPublicPosition");
      assert.equal(slug, "recepcionista-2026");
      return { slug, title: "Recepcionista", description: null };
    },
    validateStep1Fn: (input) => {
      log.push("validateStep1");
      assert.deepEqual(input, VALID_INPUT);
      return [];
    },
    renderLegalTextFn: async (key) => {
      log.push("renderLegalText");
      assert.equal(key, "pipa_step1");
      return { text: "rendered legal text", version: "v1.0", textId: "legal-text-uuid" };
    },
    insertCandidateWithConsentFn: async (params) => {
      log.push("insertCandidateWithConsent");
      assert.equal(params.positionSlug, "recepcionista-2026");
      assert.equal(params.legalTextKey, "pipa_step1");
      assert.equal(params.legalTextVersion, "v1.0");
      assert.equal(params.legalTextId, "legal-text-uuid");
      assert.equal(params.ipAddress, "1.2.3.4");
      assert.equal(params.userAgent, "test-agent");
      return { candidateId: "candidate-123", consentId: "consent-abc" };
    },
    issueAccessCodeFn: async (candidateId, purpose) => {
      log.push("issueAccessCode");
      assert.equal(candidateId, "candidate-123");
      assert.equal(purpose, "step2");
      return { rawCode: "ABCD1234", expiresAt: new Date("2026-08-06T00:00:00Z") };
    },
    insertFunnelEventFn: async (params) => {
      log.push("insertFunnelEvent");
      assert.equal(params.candidateId, "candidate-123");
      assert.equal(params.eventType, "step1_submitted");
      assert.equal(params.toStatus, "step1_completed");
    },
  });

  assert.deepEqual(result, {
    candidateId: "candidate-123",
    accessCode: "ABCD1234",
    accessCodeExpiresAt: new Date("2026-08-06T00:00:00Z"),
  });

  assert.deepEqual(log.calls, [
    "getPublicPosition",
    "validateStep1",
    "renderLegalText",
    "insertCandidateWithConsent",
    "issueAccessCode",
    "insertFunnelEvent",
  ]);
});

test("submitStep1Application: validation fails -> Step1SubmissionError, never renders legal text or inserts", async () => {
  const log = makeCallLog();
  const client = makeFakeClient();

  const validationErrors: Step1ValidationError[] = [
    { field: "email", message: "email is not a valid email address" },
  ];

  await assert.rejects(
    () =>
      submitStep1Application({
        positionSlug: "recepcionista-2026",
        input: { ...VALID_INPUT, email: "not-an-email" },
        ipAddress: "1.2.3.4",
        userAgent: null,
        consentAccepted: true,
        client,
        getPublicPositionFn: async (slug) => ({ slug, title: "Recepcionista", description: null }),
        validateStep1Fn: () => validationErrors,
        renderLegalTextFn: async () => {
          log.push("renderLegalText");
          return { text: "x", version: "v1.0", textId: "x" };
        },
        insertCandidateWithConsentFn: async () => {
          log.push("insertCandidateWithConsent");
          return { candidateId: "should-not-happen", consentId: "should-not-happen" };
        },
        issueAccessCodeFn: async () => {
          log.push("issueAccessCode");
          return { rawCode: "X", expiresAt: new Date() };
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof Step1SubmissionError);
      assert.deepEqual((err as Step1SubmissionError).validationErrors, validationErrors);
      return true;
    }
  );

  assert.deepEqual(log.calls, [], "no side-effecting function should have been called");
});

test("submitStep1Application: consentAccepted=false -> ConsentRequiredError, never renders legal text or inserts", async () => {
  const log = makeCallLog();
  const client = makeFakeClient();

  await assert.rejects(
    () =>
      submitStep1Application({
        positionSlug: "recepcionista-2026",
        input: VALID_INPUT,
        ipAddress: "1.2.3.4",
        userAgent: null,
        consentAccepted: false,
        client,
        getPublicPositionFn: async (slug) => ({ slug, title: "Recepcionista", description: null }),
        validateStep1Fn: () => [],
        renderLegalTextFn: async () => {
          log.push("renderLegalText");
          return { text: "x", version: "v1.0", textId: "x" };
        },
        insertCandidateWithConsentFn: async () => {
          log.push("insertCandidateWithConsent");
          return { candidateId: "should-not-happen", consentId: "should-not-happen" };
        },
        issueAccessCodeFn: async () => {
          log.push("issueAccessCode");
          return { rawCode: "X", expiresAt: new Date() };
        },
      }),
    ConsentRequiredError
  );

  assert.deepEqual(log.calls, [], "no side-effecting function should have been called");
});

test("submitStep1Application: position does not exist -> PositionNotFoundError propagates, never validates or inserts", async () => {
  const log = makeCallLog();
  const client = makeFakeClient();

  await assert.rejects(
    () =>
      submitStep1Application({
        positionSlug: "no-existe",
        input: VALID_INPUT,
        ipAddress: "1.2.3.4",
        userAgent: null,
        consentAccepted: true,
        client,
        getPublicPositionFn: async (slug) => {
          throw new PositionNotFoundError(slug);
        },
        validateStep1Fn: () => {
          log.push("validateStep1");
          return [];
        },
        insertCandidateWithConsentFn: async () => {
          log.push("insertCandidateWithConsent");
          return { candidateId: "should-not-happen", consentId: "should-not-happen" };
        },
      }),
    PositionNotFoundError
  );

  assert.deepEqual(log.calls, [], "no downstream function should have been called");
});

test("submitStep1Application: legal text rendering fails -> error propagates, never inserts candidate (nothing to compensate)", async () => {
  const log = makeCallLog();
  const client = makeFakeClient();
  const renderError = new Error("legal text rendering failed");

  await assert.rejects(
    () =>
      submitStep1Application({
        positionSlug: "recepcionista-2026",
        input: VALID_INPUT,
        ipAddress: "1.2.3.4",
        userAgent: null,
        consentAccepted: true,
        client,
        getPublicPositionFn: async (slug) => ({ slug, title: "Recepcionista", description: null }),
        validateStep1Fn: () => [],
        renderLegalTextFn: async () => {
          log.push("renderLegalText");
          throw renderError;
        },
        insertCandidateWithConsentFn: async () => {
          log.push("insertCandidateWithConsent");
          return { candidateId: "should-not-happen", consentId: "should-not-happen" };
        },
        issueAccessCodeFn: async () => {
          log.push("issueAccessCode");
          return { rawCode: "X", expiresAt: new Date() };
        },
      }),
    (err: unknown) => err === renderError
  );

  assert.deepEqual(log.calls, ["renderLegalText"], "insertCandidateWithConsent must never run if rendering failed");
});

test("submitStep1Application: atomic insert (RPC) fails -> error propagates, never issues an access code", async () => {
  const log = makeCallLog();
  const client = makeFakeClient();
  const rpcError = new Error("submit_step1_candidate RPC failed: consentAccepted debe ser true");

  await assert.rejects(
    () =>
      submitStep1Application({
        positionSlug: "recepcionista-2026",
        input: VALID_INPUT,
        ipAddress: "1.2.3.4",
        userAgent: null,
        consentAccepted: true,
        client,
        getPublicPositionFn: async (slug) => ({ slug, title: "Recepcionista", description: null }),
        validateStep1Fn: () => [],
        renderLegalTextFn: async () => ({ text: "x", version: "v1.0", textId: "legal-text-uuid" }),
        insertCandidateWithConsentFn: async () => {
          log.push("insertCandidateWithConsent");
          throw rpcError;
        },
        issueAccessCodeFn: async () => {
          log.push("issueAccessCode");
          return { rawCode: "X", expiresAt: new Date() };
        },
      }),
    (err: unknown) => err === rpcError
  );

  assert.deepEqual(log.calls, ["insertCandidateWithConsent"]);
});
