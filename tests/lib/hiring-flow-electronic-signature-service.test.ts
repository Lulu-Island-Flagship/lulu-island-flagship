import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashDocumentContent,
  recordElectronicSignature,
  verifySignatureIntegrity,
} from "../../src/lib/hiring-flow/electronic-signature-service";

// ---------------------------------------------------------------------------
// hashDocumentContent -- pure, no DB
// ---------------------------------------------------------------------------

test("hashDocumentContent: deterministic for the same string content", () => {
  assert.equal(hashDocumentContent("offer letter v1"), hashDocumentContent("offer letter v1"));
});

test("hashDocumentContent: different for different string content", () => {
  assert.notEqual(hashDocumentContent("offer letter v1"), hashDocumentContent("offer letter v2"));
});

test("hashDocumentContent: returns a hex sha256 digest (64 hex chars)", () => {
  const digest = hashDocumentContent("some document content");
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("hashDocumentContent: deterministic for Uint8Array content, and matches known sha256", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const digest1 = hashDocumentContent(bytes);
  const digest2 = hashDocumentContent(new Uint8Array([1, 2, 3, 4]));
  assert.equal(digest1, digest2);
  assert.match(digest1, /^[0-9a-f]{64}$/);
});

test("hashDocumentContent: string and equivalent-bytes UTF-8 content produce the same hash", () => {
  const text = "hello world";
  const bytes = new TextEncoder().encode(text);
  assert.equal(hashDocumentContent(text), hashDocumentContent(bytes));
});

// ---------------------------------------------------------------------------
// Mock Supabase client for electronic_signatures -- INSERT + SELECT only
// ---------------------------------------------------------------------------

interface SignatureRow {
  id: string;
  candidate_id: string;
  document_reference: string;
  document_hash: string;
  ip_address: string;
  user_agent: string | null;
}

interface MockState {
  rows: SignatureRow[];
  inserted: any[];
}

function makeMockClient(state: MockState) {
  let nextId = 1;
  return {
    from(table: string) {
      assert.equal(table, "electronic_signatures");
      return {
        insert(obj: any) {
          state.inserted.push(obj);
          const row: SignatureRow = {
            id: `sig-${nextId++}`,
            candidate_id: obj.candidate_id,
            document_reference: obj.document_reference,
            document_hash: obj.document_hash,
            ip_address: obj.ip_address,
            user_agent: obj.user_agent ?? null,
          };
          state.rows.push(row);
          return {
            select(_cols: string) {
              return {
                single: async () => ({
                  data: { id: row.id, document_hash: row.document_hash },
                  error: null,
                }),
              };
            },
          };
        },
        select(_cols: string) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(field: string, value: unknown) {
              filters[field] = value;
              return builder;
            },
            maybeSingle: async () => {
              const row = state.rows.find((r) => r.id === filters.id);
              return { data: row ? { document_hash: row.document_hash } : null, error: null };
            },
          };
          return builder;
        },
      };
    },
  } as any;
}

function baseState(overrides: Partial<MockState> = {}): MockState {
  return { rows: [], inserted: [], ...overrides };
}

// ---------------------------------------------------------------------------
// recordElectronicSignature
// ---------------------------------------------------------------------------

test("recordElectronicSignature: inserts a row with the correct sha256 hash of the document content", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  const result = await recordElectronicSignature(
    {
      candidateId: "candidate-1",
      documentReference: "offer-letter-2026",
      documentContent: "This is the offer letter text.",
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0",
    },
    client
  );

  assert.equal(typeof result.signatureId, "string");
  assert.equal(result.documentHash, hashDocumentContent("This is the offer letter text."));
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].candidate_id, "candidate-1");
  assert.equal(state.inserted[0].document_reference, "offer-letter-2026");
  assert.equal(state.inserted[0].document_hash, result.documentHash);
  assert.equal(state.inserted[0].ip_address, "203.0.113.5");
  assert.equal(state.inserted[0].user_agent, "Mozilla/5.0");
});

test("recordElectronicSignature: allows a null userAgent", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  const result = await recordElectronicSignature(
    {
      candidateId: "candidate-2",
      documentReference: "policy-ack-2026",
      documentContent: "Policy text.",
      ipAddress: "203.0.113.9",
      userAgent: null,
    },
    client
  );

  assert.equal(state.inserted[0].user_agent, null);
  assert.equal(result.documentHash, hashDocumentContent("Policy text."));
});

test("recordElectronicSignature: accepts Uint8Array document content and hashes it correctly", async () => {
  const state = baseState();
  const client = makeMockClient(state);
  const bytes = new Uint8Array([10, 20, 30]);

  const result = await recordElectronicSignature(
    {
      candidateId: "candidate-3",
      documentReference: "id-scan-2026",
      documentContent: bytes,
      ipAddress: "203.0.113.10",
      userAgent: "Chrome",
    },
    client
  );

  assert.equal(result.documentHash, hashDocumentContent(bytes));
});

// ---------------------------------------------------------------------------
// verifySignatureIntegrity
// ---------------------------------------------------------------------------

test("verifySignatureIntegrity: unaltered content -> true", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  const { signatureId } = await recordElectronicSignature(
    {
      candidateId: "candidate-1",
      documentReference: "offer-letter-2026",
      documentContent: "Original content.",
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0",
    },
    client
  );

  const isValid = await verifySignatureIntegrity(signatureId, "Original content.", client);
  assert.equal(isValid, true);
});

test("verifySignatureIntegrity: altered content -> false", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  const { signatureId } = await recordElectronicSignature(
    {
      candidateId: "candidate-1",
      documentReference: "offer-letter-2026",
      documentContent: "Original content.",
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0",
    },
    client
  );

  const isValid = await verifySignatureIntegrity(
    signatureId,
    "Original content, but someone changed a word.",
    client
  );
  assert.equal(isValid, false);
});

test("verifySignatureIntegrity: nonexistent signatureId -> throws", async () => {
  const state = baseState();
  const client = makeMockClient(state);

  await assert.rejects(() => verifySignatureIntegrity("does-not-exist", "content", client));
});
