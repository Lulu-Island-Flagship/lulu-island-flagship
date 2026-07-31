import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractPlaceholders,
  renderTemplate,
  renderLegalText,
  LegalTextNotFoundError,
  UnrenderedPlaceholderError,
} from "../../src/lib/hiring-flow/legal-text-service";

// ---------------------------------------------------------------------------
// extractPlaceholders — pure, no DB
// ---------------------------------------------------------------------------

test("extractPlaceholders: no placeholders -> empty array", () => {
  assert.deepEqual(extractPlaceholders("Plain text, nothing to see here."), []);
});

test("extractPlaceholders: single placeholder", () => {
  assert.deepEqual(extractPlaceholders("Hello [COMPANY_NAME]!"), ["COMPANY_NAME"]);
});

test("extractPlaceholders: multiple distinct placeholders, preserves each once", () => {
  const content = "[COMPANY_NAME] hires you as [JOB_TITLE] starting [START_DATE].";
  assert.deepEqual(extractPlaceholders(content), [
    "COMPANY_NAME",
    "JOB_TITLE",
    "START_DATE",
  ]);
});

test("extractPlaceholders: repeated placeholder -> deduplicated", () => {
  const content = "[COMPANY_NAME] and [COMPANY_NAME] again, plus [COMPANY_NAME].";
  assert.deepEqual(extractPlaceholders(content), ["COMPANY_NAME"]);
});

test("extractPlaceholders: ignores things that aren't SCREAMING_SNAKE bracket patterns", () => {
  assert.deepEqual(extractPlaceholders("See item [1] and note [a] here."), []);
});

// ---------------------------------------------------------------------------
// renderTemplate — pure, no DB
// ---------------------------------------------------------------------------

test("renderTemplate: happy path, single variable", () => {
  const result = renderTemplate("Welcome to [COMPANY_NAME].", {
    COMPANY_NAME: "Lulu Island",
  });
  assert.equal(result, "Welcome to Lulu Island.");
});

test("renderTemplate: happy path, multiple variables", () => {
  const result = renderTemplate(
    "[COMPANY_NAME] hires you as [JOB_TITLE] starting [START_DATE].",
    {
      COMPANY_NAME: "Lulu Island",
      JOB_TITLE: "Chef",
      START_DATE: "2026-08-01",
    }
  );
  assert.equal(result, "Lulu Island hires you as Chef starting 2026-08-01.");
});

test("renderTemplate: missing variable for placeholder -> throws UnrenderedPlaceholderError with correct name", () => {
  assert.throws(
    () => renderTemplate("Hello [COMPANY_NAME], role [MISSING_VAR].", {
      COMPANY_NAME: "Lulu Island",
    }),
    (err: unknown) => {
      assert.ok(err instanceof UnrenderedPlaceholderError);
      assert.match(err.message, /MISSING_VAR/);
      assert.deepEqual(err.placeholders, ["MISSING_VAR"]);
      return true;
    }
  );
});

test("renderTemplate: extra unused variables are ignored, not an error", () => {
  const result = renderTemplate("Hello [COMPANY_NAME].", {
    COMPANY_NAME: "Lulu Island",
    UNUSED_EXTRA: "does not matter",
  });
  assert.equal(result, "Hello Lulu Island.");
});

test("renderTemplate: case-sensitive exact match required", () => {
  assert.throws(
    () => renderTemplate("Hello [COMPANY_NAME].", { company_name: "lowercase" }),
    UnrenderedPlaceholderError
  );
});

// ---------------------------------------------------------------------------
// Mock Supabase client for renderLegalText
// ---------------------------------------------------------------------------

interface FakeLegalTextRow {
  id: string;
  key: string;
  version: string;
  content: string;
  is_active: boolean;
}

interface FakeSettingRow {
  key: string;
  value: string;
  value_type: "string" | "number" | "boolean" | "json";
}

function makeMockClient(legalRows: FakeLegalTextRow[], settingRows: FakeSettingRow[]) {
  return {
    from(table: string) {
      if (table === "legal_texts") {
        return {
          select(_cols: string) {
            return {
              eq(field: string, value: unknown) {
                assert.equal(field, "key");
                const matched = legalRows.filter((r) => r.key === value);
                return Promise.resolve({
                  data: matched.map((r) => ({
                    id: r.id,
                    version: r.version,
                    content: r.content,
                    is_active: r.is_active,
                  })),
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === "system_settings") {
        return {
          select(_cols: string) {
            return {
              eq(field: string, value: unknown) {
                assert.equal(field, "key");
                const row = settingRows.find((r) => r.key === value);
                return {
                  single: async () => {
                    if (!row) {
                      return { data: null, error: { message: "not found" } };
                    }
                    return {
                      data: { value: row.value, value_type: row.value_type },
                      error: null,
                    };
                  },
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

// ---------------------------------------------------------------------------
// renderLegalText
// ---------------------------------------------------------------------------

test("renderLegalText: key never existed -> LegalTextNotFoundError (no_such_key)", async () => {
  const client = makeMockClient([], [{ key: "company_name", value: "Lulu Island", value_type: "string" }]);

  await assert.rejects(
    () => renderLegalText("does_not_exist", {}, client),
    (err: unknown) => {
      assert.ok(err instanceof LegalTextNotFoundError);
      assert.equal(err.reason, "no_such_key");
      return true;
    }
  );
});

test("renderLegalText: key exists but no active version -> LegalTextNotFoundError (no_active_version)", async () => {
  const client = makeMockClient(
    [
      {
        id: "id-1",
        key: "pipa_step1",
        version: "v0.9",
        content: "Old inactive text from [COMPANY_NAME].",
        is_active: false,
      },
    ],
    [{ key: "company_name", value: "Lulu Island", value_type: "string" }]
  );

  await assert.rejects(
    () => renderLegalText("pipa_step1", {}, client),
    (err: unknown) => {
      assert.ok(err instanceof LegalTextNotFoundError);
      assert.equal(err.reason, "no_active_version");
      return true;
    }
  );
});

test("renderLegalText: resolves [COMPANY_NAME] automatically via getSetting('company_name')", async () => {
  const client = makeMockClient(
    [
      {
        id: "id-2",
        key: "pipa_step1",
        version: "v1.0",
        content: "Welcome to [COMPANY_NAME], this is our privacy notice.",
        is_active: true,
      },
    ],
    [{ key: "company_name", value: "Lulu Island Flagship", value_type: "string" }]
  );

  const result = await renderLegalText("pipa_step1", {}, client);
  assert.equal(result.text, "Welcome to Lulu Island Flagship, this is our privacy notice.");
  assert.equal(result.version, "v1.0");
  assert.equal(result.textId, "id-2");
});

test("renderLegalText: caller-provided variables can override COMPANY_NAME default", async () => {
  const client = makeMockClient(
    [
      {
        id: "id-3",
        key: "crc_consent",
        version: "v1.0",
        content: "[COMPANY_NAME] requests your consent.",
        is_active: true,
      },
    ],
    [{ key: "company_name", value: "Default Co", value_type: "string" }]
  );

  const result = await renderLegalText("crc_consent", { COMPANY_NAME: "Override Co" }, client);
  assert.equal(result.text, "Override Co requests your consent.");
});

test("renderLegalText: unknown placeholder left in content -> UnrenderedPlaceholderError, propagated as-is", async () => {
  const client = makeMockClient(
    [
      {
        id: "id-4",
        key: "pipa_step1",
        version: "v1.0",
        content: "Welcome to [COMPANY_NAME]. Contact [UNKNOWN_VAR] for details.",
        is_active: true,
      },
    ],
    [{ key: "company_name", value: "Lulu Island", value_type: "string" }]
  );

  await assert.rejects(
    () => renderLegalText("pipa_step1", {}, client),
    (err: unknown) => {
      assert.ok(err instanceof UnrenderedPlaceholderError);
      assert.match(err.message, /pipa_step1/);
      assert.match(err.message, /UNKNOWN_VAR/);
      assert.deepEqual(err.placeholders, ["UNKNOWN_VAR"]);
      return true;
    }
  );
});
