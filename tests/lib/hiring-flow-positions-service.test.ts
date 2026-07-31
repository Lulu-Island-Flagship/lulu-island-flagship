import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPublicPosition,
  PositionNotFoundError,
} from "../../src/lib/hiring-flow/positions-service";

// ---------------------------------------------------------------------------
// Mock Supabase client (mismo estilo que settings-service.test.ts)
// ---------------------------------------------------------------------------

interface FakePosition {
  slug: string;
  title: string;
  description: string | null;
  is_public: boolean;
}

function makeMockClient(rows: FakePosition[]) {
  return {
    from(table: string) {
      assert.equal(table, "positions");
      return {
        select(_cols: string) {
          return {
            eq(field1: string, value1: unknown) {
              assert.equal(field1, "slug");
              return {
                eq(field2: string, value2: unknown) {
                  assert.equal(field2, "is_public");
                  return {
                    maybeSingle: async () => {
                      const row = rows.find(
                        (r) => r.slug === value1 && r.is_public === value2
                      );
                      return { data: row ?? null, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as any;
}

test("getPublicPosition: exists and is public -> returns PublicPosition without id", async () => {
  const client = makeMockClient([
    { slug: "recepcionista-2026", title: "Recepcionista", description: "Turno de día", is_public: true },
  ]);

  const result = await getPublicPosition("recepcionista-2026", client);
  assert.deepEqual(result, {
    slug: "recepcionista-2026",
    title: "Recepcionista",
    description: "Turno de día",
  });
  assert.equal("id" in result, false, "PublicPosition must never expose internal id");
});

test("getPublicPosition: exists but not public -> PositionNotFoundError (same as non-existent)", async () => {
  const client = makeMockClient([
    { slug: "gerente-secreto", title: "Gerente", description: null, is_public: false },
  ]);

  await assert.rejects(
    () => getPublicPosition("gerente-secreto", client),
    PositionNotFoundError
  );
});

test("getPublicPosition: does not exist at all -> PositionNotFoundError", async () => {
  const client = makeMockClient([]);

  await assert.rejects(
    () => getPublicPosition("no-existe", client),
    PositionNotFoundError
  );
});

test("getPublicPosition: error message includes the slug", async () => {
  const client = makeMockClient([]);
  await assert.rejects(
    () => getPublicPosition("some-slug", client),
    /some-slug/
  );
});
