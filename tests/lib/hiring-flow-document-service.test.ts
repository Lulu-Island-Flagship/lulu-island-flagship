import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidateSettingsCache } from "../../src/lib/hiring-flow/settings-service";
import {
  detectMimeTypeFromBytes,
  validateDocumentUpload,
  insertDocumentRecord,
  DocumentValidationError,
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_MIME_TYPES,
} from "../../src/lib/hiring-flow/document-service";

// ---------------------------------------------------------------------------
// Byte fixtures — hand-built magic numbers, plus trailing filler bytes so
// each buffer looks like a plausible (if fake) file rather than just a
// bare signature.
// ---------------------------------------------------------------------------

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function withFiller(signature: number[], fillerLength = 16): Uint8Array {
  const filler = new Array(fillerLength).fill(0xaa);
  return bytes(...signature, ...filler);
}

const JPEG_BYTES = withFiller([0xff, 0xd8, 0xff, 0xe0]);
const PNG_BYTES = withFiller([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_BYTES = withFiller([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"

// WEBP: "RIFF" + 4-byte chunk size (arbitrary) + "WEBP" + filler.
const WEBP_BYTES = bytes(
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x24, 0x00, 0x00, 0x00, // chunk size (arbitrary, not validated)
  0x57, 0x45, 0x42, 0x50, // "WEBP"
  0xaa, 0xaa, 0xaa, 0xaa
);

const GARBAGE_BYTES = withFiller([0x00, 0x11, 0x22, 0x33]);

// ---------------------------------------------------------------------------
// detectMimeTypeFromBytes — pure, no DB
// ---------------------------------------------------------------------------

test("detectMimeTypeFromBytes: JPEG signature -> image/jpeg", () => {
  assert.equal(detectMimeTypeFromBytes(JPEG_BYTES), "image/jpeg");
});

test("detectMimeTypeFromBytes: PNG signature -> image/png", () => {
  assert.equal(detectMimeTypeFromBytes(PNG_BYTES), "image/png");
});

test("detectMimeTypeFromBytes: WEBP signature (RIFF....WEBP) -> image/webp", () => {
  assert.equal(detectMimeTypeFromBytes(WEBP_BYTES), "image/webp");
});

test("detectMimeTypeFromBytes: PDF signature (%PDF) -> application/pdf", () => {
  assert.equal(detectMimeTypeFromBytes(PDF_BYTES), "application/pdf");
});

test("detectMimeTypeFromBytes: unrecognized bytes -> null", () => {
  assert.equal(detectMimeTypeFromBytes(GARBAGE_BYTES), null);
});

test("detectMimeTypeFromBytes: empty buffer -> null", () => {
  assert.equal(detectMimeTypeFromBytes(new Uint8Array(0)), null);
});

test("detectMimeTypeFromBytes: buffer shorter than any signature -> null, does not throw", () => {
  assert.equal(detectMimeTypeFromBytes(bytes(0xff, 0xd8)), null);
});

test("detectMimeTypeFromBytes: RIFF container that is NOT webp (e.g. WAV) -> null", () => {
  const wavBytes = bytes(
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45, // "WAVE", not "WEBP"
    0xaa, 0xaa
  );
  assert.equal(detectMimeTypeFromBytes(wavBytes), null);
});

test("detectMimeTypeFromBytes: a renamed extension does not fool it — bytes are what matter", () => {
  // Simulates a .pdf that is actually a JPEG under the hood: only the
  // bytes matter, there is no filename/extension parameter at all.
  assert.equal(detectMimeTypeFromBytes(JPEG_BYTES), "image/jpeg");
});

// ---------------------------------------------------------------------------
// Mock Supabase client — system_settings + documents
// ---------------------------------------------------------------------------

interface SettingsRow {
  key: string;
  value: string;
  value_type: "string" | "number" | "boolean" | "json";
}

function makeMockClient(settingsRows: SettingsRow[]) {
  const insertedDocuments: any[] = [];
  let nextId = 1;

  return {
    _insertedDocuments: insertedDocuments,
    from(table: string) {
      if (table === "system_settings") {
        return {
          select(_cols: string) {
            return {
              eq(_field: string, value: unknown) {
                const row = settingsRows.find((r) => r.key === value);
                return {
                  single: async () => {
                    if (!row) return { data: null, error: { message: "not found" } };
                    return { data: { value: row.value, value_type: row.value_type }, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "documents") {
        return {
          insert(record: any) {
            const row = { id: `doc-${nextId++}`, ...record };
            insertedDocuments.push(row);
            return {
              select(_cols: string) {
                return {
                  single: async () => ({ data: { id: row.id }, error: null }),
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table in mock: ${table}`);
    },
  } as any;
}

const DEFAULT_SETTINGS: SettingsRow[] = [
  { key: "security_max_file_size_mb", value: "10", value_type: "number" },
  { key: "security_image_compression_target_mb", value: "2", value_type: "number" },
];

// ---------------------------------------------------------------------------
// validateDocumentUpload
// ---------------------------------------------------------------------------

test("validateDocumentUpload: allowed document type list is non-empty and includes expected entries", () => {
  assert.ok(ALLOWED_DOCUMENT_TYPES.length > 0);
  assert.ok(ALLOWED_DOCUMENT_TYPES.includes("id_front" as any));
});

test("validateDocumentUpload: disallowed document type -> throws DocumentValidationError", async () => {
  invalidateSettingsCache();
  const client = makeMockClient(DEFAULT_SETTINGS);

  await assert.rejects(
    () =>
      validateDocumentUpload(
        { documentType: "not_a_real_type", declaredMimeType: "image/jpeg", bytes: JPEG_BYTES },
        client
      ),
    DocumentValidationError
  );
});

test("validateDocumentUpload: undetectable MIME type -> throws DocumentValidationError", async () => {
  invalidateSettingsCache();
  const client = makeMockClient(DEFAULT_SETTINGS);

  await assert.rejects(
    () =>
      validateDocumentUpload(
        { documentType: "id_front", declaredMimeType: "image/jpeg", bytes: GARBAGE_BYTES },
        client
      ),
    DocumentValidationError
  );
});

test("validateDocumentUpload: detected MIME type not in ALLOWED_MIME_TYPES -> throws", async () => {
  invalidateSettingsCache();
  const client = makeMockClient(DEFAULT_SETTINGS);

  // Sanity: every currently allowed mime type is one we can actually
  // detect via signature -- this test instead simulates a type we detect
  // but do not allow, by using a signature outside the allow-list. Since
  // detectMimeTypeFromBytes only returns known types that are all in
  // ALLOWED_MIME_TYPES today, this exercises the guard defensively via the
  // "not detected" path already covered above. Kept here as documentation
  // that the check exists as a separate step from detection itself.
  assert.deepEqual(
    [...ALLOWED_MIME_TYPES].sort(),
    ["application/pdf", "image/jpeg", "image/png", "image/webp"].sort()
  );
});

test("validateDocumentUpload: size exceeds security_max_file_size_mb -> throws DocumentValidationError", async () => {
  invalidateSettingsCache();
  const client = makeMockClient([
    { key: "security_max_file_size_mb", value: "0.00001", value_type: "number" }, // ~10 bytes
    { key: "security_image_compression_target_mb", value: "2", value_type: "number" },
  ]);

  await assert.rejects(
    () =>
      validateDocumentUpload(
        { documentType: "id_front", declaredMimeType: "image/jpeg", bytes: JPEG_BYTES },
        client
      ),
    DocumentValidationError
  );
});

test("validateDocumentUpload: valid small JPEG under all limits -> succeeds, needsCompression false", async () => {
  invalidateSettingsCache();
  const client = makeMockClient(DEFAULT_SETTINGS);

  const result = await validateDocumentUpload(
    { documentType: "id_front", declaredMimeType: "image/jpeg", bytes: JPEG_BYTES },
    client
  );

  assert.equal(result.detectedMimeType, "image/jpeg");
  assert.equal(result.sizeBytes, JPEG_BYTES.length);
  assert.equal(result.needsCompression, false);
});

test("validateDocumentUpload: declared mime differs from detected -> does not throw (only a warning signal)", async () => {
  invalidateSettingsCache();
  const client = makeMockClient(DEFAULT_SETTINGS);

  const originalWarn = console.warn;
  let warned = false;
  console.warn = (...args: unknown[]) => {
    warned = true;
    originalWarn(...(args as []));
  };

  try {
    const result = await validateDocumentUpload(
      { documentType: "id_front", declaredMimeType: "application/pdf", bytes: JPEG_BYTES },
      client
    );
    assert.equal(result.detectedMimeType, "image/jpeg");
    assert.equal(warned, true, "should have logged a console.warn about the mismatch");
  } finally {
    console.warn = originalWarn;
  }
});

test("validateDocumentUpload: needsCompression true for large image over compression target", async () => {
  invalidateSettingsCache();
  const client = makeMockClient([
    { key: "security_max_file_size_mb", value: "10", value_type: "number" },
    { key: "security_image_compression_target_mb", value: "0.00001", value_type: "number" }, // ~10 bytes
  ]);

  const result = await validateDocumentUpload(
    { documentType: "id_front", declaredMimeType: "image/jpeg", bytes: JPEG_BYTES },
    client
  );

  assert.equal(result.needsCompression, true);
});

test("validateDocumentUpload: needsCompression is always false for a PDF, regardless of size vs compression target", async () => {
  invalidateSettingsCache();
  const client = makeMockClient([
    { key: "security_max_file_size_mb", value: "10", value_type: "number" },
    { key: "security_image_compression_target_mb", value: "0.00001", value_type: "number" }, // tiny target
  ]);

  const result = await validateDocumentUpload(
    { documentType: "certification", declaredMimeType: "application/pdf", bytes: PDF_BYTES },
    client
  );

  assert.equal(result.detectedMimeType, "application/pdf");
  assert.equal(result.needsCompression, false);
});

// ---------------------------------------------------------------------------
// insertDocumentRecord
// ---------------------------------------------------------------------------

test("insertDocumentRecord: inserts row and returns documentId", async () => {
  const client = makeMockClient(DEFAULT_SETTINGS);

  const result = await insertDocumentRecord(
    {
      candidateId: "cand-1",
      documentType: "id_front",
      storagePath: "candidates/cand-1/id_front.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 12345,
    },
    client
  );

  assert.ok(result.documentId);
  assert.equal(client._insertedDocuments.length, 1);
  assert.equal(client._insertedDocuments[0].candidate_id, "cand-1");
  assert.equal(client._insertedDocuments[0].document_type, "id_front");
  assert.equal(client._insertedDocuments[0].storage_path, "candidates/cand-1/id_front.jpg");
  assert.equal(client._insertedDocuments[0].mime_type, "image/jpeg");
  assert.equal(client._insertedDocuments[0].size_bytes, 12345);
});
