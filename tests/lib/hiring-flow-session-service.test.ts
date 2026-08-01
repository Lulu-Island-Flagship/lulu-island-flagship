import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidateSettingsCache } from "../../src/lib/hiring-flow/settings-service";
import { hashCode } from "../../src/lib/hiring-flow/access-code-service";
import {
  createSession,
  validateSession,
  renewSession,
  invalidateSession,
  purgeExpiredSessions,
  SessionInvalidError,
  SessionExpiredError,
} from "../../src/lib/hiring-flow/session-service";

// ---------------------------------------------------------------------------
// Mock Supabase client — supports "system_settings" and "sessions"
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  candidate_id: string;
  token_hash: string;
  expires_at: string;
  last_activity_at: string;
  invalidated_at: string | null;
}

interface MockState {
  settingsRows: Array<{ key: string; value: string; value_type: "string" | "number" | "boolean" | "json" }>;
  sessionRows: SessionRow[];
  inserted: any[];
}

function makeMockClient(state: MockState) {
  return {
    from(table: string) {
      if (table === "system_settings") {
        return {
          select(_cols: string) {
            return {
              eq(_field: string, value: unknown) {
                const row = state.settingsRows.find((r) => r.key === value);
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

      if (table === "sessions") {
        return {
          insert(obj: any) {
            state.inserted.push(obj);
            const row: SessionRow = {
              id: `generated-${state.sessionRows.length + 1}`,
              candidate_id: obj.candidate_id,
              token_hash: obj.token_hash,
              expires_at: obj.expires_at,
              last_activity_at: obj.last_activity_at,
              invalidated_at: null,
            };
            state.sessionRows.push(row);
            return Promise.resolve({ error: null });
          },
          select(_cols: string) {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(field: string, value: unknown) {
                filters[field] = value;
                return builder;
              },
              maybeSingle: async () => {
                const row = state.sessionRows.find((r) =>
                  Object.entries(filters).every(([f, v]) => (r as any)[f] === v)
                );
                return { data: row ?? null, error: null };
              },
            };
            return builder;
          },
          update(patch: any) {
            return {
              eq: async (field: string, value: unknown) => {
                const row = state.sessionRows.find((r) => (r as any)[field] === value);
                if (row) Object.assign(row, patch);
                return { error: null };
              },
            };
          },
          delete() {
            return {
              lt: (field: string, value: string) => {
                const toDelete = state.sessionRows.filter((r) => (r as any)[field] < value);
                return {
                  select: async (_cols: string) => {
                    state.sessionRows = state.sessionRows.filter(
                      (r) => !toDelete.includes(r)
                    );
                    return { data: toDelete.map((r) => ({ id: r.id })), error: null };
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

function baseState(overrides: Partial<MockState> = {}): MockState {
  return {
    settingsRows: [{ key: "security_session_duration_hours", value: "12", value_type: "number" }],
    sessionRows: [],
    inserted: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

test("createSession: inserts a hashed token and returns raw token + expiresAt from settings", async () => {
  invalidateSettingsCache();
  const state = baseState();
  const client = makeMockClient(state);

  const before = Date.now();
  const result = await createSession("candidate-1", client);
  const after = Date.now();

  assert.equal(typeof result.rawToken, "string");
  assert.ok(result.expiresAt instanceof Date);

  const expectedMin = before + 12 * 60 * 60 * 1000;
  const expectedMax = after + 12 * 60 * 60 * 1000;
  assert.ok(result.expiresAt.getTime() >= expectedMin);
  assert.ok(result.expiresAt.getTime() <= expectedMax);

  assert.equal(state.inserted.length, 1);
  assert.notEqual(state.inserted[0].token_hash, result.rawToken);
  assert.equal(state.inserted[0].token_hash, hashCode(result.rawToken));
});

// ---------------------------------------------------------------------------
// validateSession
// ---------------------------------------------------------------------------

test("validateSession: valid, active session -> returns sessionId + candidateId", async () => {
  invalidateSettingsCache();
  const rawToken = "VALIDTOK";
  const state = baseState({
    sessionRows: [
      {
        id: "sess-1",
        candidate_id: "candidate-1",
        token_hash: hashCode(rawToken),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        last_activity_at: new Date().toISOString(),
        invalidated_at: null,
      },
    ],
  });
  const client = makeMockClient(state);

  const result = await validateSession(rawToken, client);
  assert.equal(result.sessionId, "sess-1");
  assert.equal(result.candidateId, "candidate-1");
});

// Fix (auditoría externa, hallazgo confirmado): validateSession() ahora
// refresca last_activity_at en cada validación exitosa -- ver comentario en
// session-service.ts.
test("validateSession: successful validation refreshes last_activity_at", async () => {
  invalidateSettingsCache();
  const rawToken = "VALIDTOK2";
  const staleActivity = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  const state = baseState({
    sessionRows: [
      {
        id: "sess-touch",
        candidate_id: "candidate-1",
        token_hash: hashCode(rawToken),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        last_activity_at: staleActivity,
        invalidated_at: null,
      },
    ],
  });
  const client = makeMockClient(state);

  await validateSession(rawToken, client);

  const updatedRow = state.sessionRows.find((r) => r.id === "sess-touch");
  assert.ok(updatedRow);
  assert.notEqual(updatedRow!.last_activity_at, staleActivity);
  assert.ok(new Date(updatedRow!.last_activity_at).getTime() > new Date(staleActivity).getTime());
});

test("validateSession: nonexistent token -> SessionInvalidError", async () => {
  invalidateSettingsCache();
  const state = baseState({ sessionRows: [] });
  const client = makeMockClient(state);

  await assert.rejects(() => validateSession("NOPE1234", client), SessionInvalidError);
});

test("validateSession: invalidated session -> SessionInvalidError", async () => {
  invalidateSettingsCache();
  const rawToken = "INVALID1";
  const state = baseState({
    sessionRows: [
      {
        id: "sess-2",
        candidate_id: "candidate-1",
        token_hash: hashCode(rawToken),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        last_activity_at: new Date().toISOString(),
        invalidated_at: new Date().toISOString(),
      },
    ],
  });
  const client = makeMockClient(state);

  await assert.rejects(() => validateSession(rawToken, client), SessionInvalidError);
});

test("validateSession: expires_at in the past -> SessionExpiredError", async () => {
  invalidateSettingsCache();
  const rawToken = "EXPTOKEN";
  const state = baseState({
    sessionRows: [
      {
        id: "sess-3",
        candidate_id: "candidate-1",
        token_hash: hashCode(rawToken),
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        last_activity_at: new Date().toISOString(),
        invalidated_at: null,
      },
    ],
  });
  const client = makeMockClient(state);

  await assert.rejects(() => validateSession(rawToken, client), SessionExpiredError);
});

test("validateSession: inactive beyond the configured duration window -> SessionExpiredError", async () => {
  invalidateSettingsCache();
  const rawToken = "IDLETOKN";
  // expires_at itself is still in the future, but last_activity_at is well
  // beyond the security_session_duration_hours (12h) inactivity window.
  const state = baseState({
    sessionRows: [
      {
        id: "sess-4",
        candidate_id: "candidate-1",
        token_hash: hashCode(rawToken),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        last_activity_at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
        invalidated_at: null,
      },
    ],
  });
  const client = makeMockClient(state);

  await assert.rejects(() => validateSession(rawToken, client), SessionExpiredError);
});

// ---------------------------------------------------------------------------
// renewSession / invalidateSession
// ---------------------------------------------------------------------------

test("renewSession: updates last_activity_at on the matching row", async () => {
  invalidateSettingsCache();
  const oldActivity = new Date(Date.now() - 60_000).toISOString();
  const state = baseState({
    sessionRows: [
      {
        id: "sess-5",
        candidate_id: "candidate-1",
        token_hash: hashCode("RENEWME1"),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        last_activity_at: oldActivity,
        invalidated_at: null,
      },
    ],
  });
  const client = makeMockClient(state);

  await renewSession("sess-5", client);
  assert.notEqual(state.sessionRows[0].last_activity_at, oldActivity);
});

test("invalidateSession: sets invalidated_at on the matching row", async () => {
  invalidateSettingsCache();
  const state = baseState({
    sessionRows: [
      {
        id: "sess-6",
        candidate_id: "candidate-1",
        token_hash: hashCode("KILLME12"),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        last_activity_at: new Date().toISOString(),
        invalidated_at: null,
      },
    ],
  });
  const client = makeMockClient(state);

  await invalidateSession("sess-6", client);
  assert.notEqual(state.sessionRows[0].invalidated_at, null);
});

// ---------------------------------------------------------------------------
// purgeExpiredSessions
// ---------------------------------------------------------------------------

test("purgeExpiredSessions: removes only expired rows, returns count", async () => {
  invalidateSettingsCache();
  const state = baseState({
    sessionRows: [
      {
        id: "sess-old",
        candidate_id: "candidate-1",
        token_hash: hashCode("OLDONE01"),
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        last_activity_at: new Date().toISOString(),
        invalidated_at: null,
      },
      {
        id: "sess-fresh",
        candidate_id: "candidate-2",
        token_hash: hashCode("FRESHONE"),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        last_activity_at: new Date().toISOString(),
        invalidated_at: null,
      },
    ],
  });
  const client = makeMockClient(state);

  const purged = await purgeExpiredSessions(client);
  assert.equal(purged, 1);
  assert.equal(state.sessionRows.length, 1);
  assert.equal(state.sessionRows[0].id, "sess-fresh");
});
