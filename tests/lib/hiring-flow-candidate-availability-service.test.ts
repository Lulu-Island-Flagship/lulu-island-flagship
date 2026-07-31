import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAvailabilityBlock,
  validateAvailabilityBlocks,
  setCandidateAvailability,
  getCandidateAvailability,
  AvailabilityValidationError,
  type AvailabilityBlockInput,
} from "../../src/lib/hiring-flow/candidate-availability-service";

// ---------------------------------------------------------------------------
// validateAvailabilityBlock — pure, no DB
// ---------------------------------------------------------------------------

test("validateAvailabilityBlock: valid block -> no errors", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" });
  assert.deepEqual(errors, []);
});

test("validateAvailabilityBlock: dayOfWeek out of range (negative)", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: -1, startTime: "09:00", endTime: "17:00" });
  assert.ok(errors.some((e) => e.field === "dayOfWeek"));
});

test("validateAvailabilityBlock: dayOfWeek out of range (>6)", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: 7, startTime: "09:00", endTime: "17:00" });
  assert.ok(errors.some((e) => e.field === "dayOfWeek"));
});

test("validateAvailabilityBlock: dayOfWeek non-integer", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: 2.5, startTime: "09:00", endTime: "17:00" });
  assert.ok(errors.some((e) => e.field === "dayOfWeek"));
});

test("validateAvailabilityBlock: dayOfWeek 0 and 6 boundaries are valid", () => {
  assert.deepEqual(
    validateAvailabilityBlock({ dayOfWeek: 0, startTime: "09:00", endTime: "10:00" }),
    []
  );
  assert.deepEqual(
    validateAvailabilityBlock({ dayOfWeek: 6, startTime: "09:00", endTime: "10:00" }),
    []
  );
});

test("validateAvailabilityBlock: invalid startTime format", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: 1, startTime: "9:00", endTime: "17:00" });
  assert.ok(errors.some((e) => e.field === "startTime"));
});

test("validateAvailabilityBlock: invalid endTime format (hour out of range)", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: 1, startTime: "09:00", endTime: "25:00" });
  assert.ok(errors.some((e) => e.field === "endTime"));
});

test("validateAvailabilityBlock: garbage time strings", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: 1, startTime: "noon", endTime: "later" });
  assert.ok(errors.some((e) => e.field === "startTime"));
  assert.ok(errors.some((e) => e.field === "endTime"));
});

test("validateAvailabilityBlock: endTime equal to startTime -> error (0-minute block)", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: 1, startTime: "09:00", endTime: "09:00" });
  assert.ok(errors.some((e) => e.field === "endTime" && /after/i.test(e.message)));
});

test("validateAvailabilityBlock: endTime before startTime -> error", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: 1, startTime: "17:00", endTime: "09:00" });
  assert.ok(errors.some((e) => e.field === "endTime" && /after/i.test(e.message)));
});

test("validateAvailabilityBlock: accumulates multiple errors at once", () => {
  const errors = validateAvailabilityBlock({ dayOfWeek: 99, startTime: "bad", endTime: "worse" });
  assert.equal(errors.length, 3);
  const fields = errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ["dayOfWeek", "endTime", "startTime"]);
});

// ---------------------------------------------------------------------------
// validateAvailabilityBlocks — array-level: index prefixing + overlap
// ---------------------------------------------------------------------------

test("validateAvailabilityBlocks: valid non-overlapping blocks across different days -> no errors", () => {
  const blocks: AvailabilityBlockInput[] = [
    { dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
    { dayOfWeek: 2, startTime: "09:00", endTime: "12:00" },
  ];
  assert.deepEqual(validateAvailabilityBlocks(blocks), []);
});

test("validateAvailabilityBlocks: prefixes index to field name for per-block errors", () => {
  const blocks: AvailabilityBlockInput[] = [
    { dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
    { dayOfWeek: 9, startTime: "09:00", endTime: "12:00" },
  ];
  const errors = validateAvailabilityBlocks(blocks);
  assert.ok(errors.some((e) => e.field === "blocks[1].dayOfWeek"));
});

test("validateAvailabilityBlocks: accumulates errors across multiple invalid blocks", () => {
  const blocks: AvailabilityBlockInput[] = [
    { dayOfWeek: -1, startTime: "09:00", endTime: "12:00" },
    { dayOfWeek: 1, startTime: "bad", endTime: "12:00" },
  ];
  const errors = validateAvailabilityBlocks(blocks);
  assert.ok(errors.some((e) => e.field === "blocks[0].dayOfWeek"));
  assert.ok(errors.some((e) => e.field === "blocks[1].startTime"));
});

test("validateAvailabilityBlocks: overlapping blocks on the SAME day -> error", () => {
  const blocks: AvailabilityBlockInput[] = [
    { dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
    { dayOfWeek: 1, startTime: "11:00", endTime: "14:00" },
  ];
  const errors = validateAvailabilityBlocks(blocks);
  assert.ok(errors.some((e) => e.field === "blocks" && /overlap/i.test(e.message)));
});

test("validateAvailabilityBlocks: fully contained overlap on same day -> error", () => {
  const blocks: AvailabilityBlockInput[] = [
    { dayOfWeek: 3, startTime: "08:00", endTime: "18:00" },
    { dayOfWeek: 3, startTime: "10:00", endTime: "11:00" },
  ];
  const errors = validateAvailabilityBlocks(blocks);
  assert.ok(errors.some((e) => e.field === "blocks" && /overlap/i.test(e.message)));
});

test("validateAvailabilityBlocks: adjacent (touching, not overlapping) blocks same day -> no overlap error", () => {
  const blocks: AvailabilityBlockInput[] = [
    { dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
    { dayOfWeek: 1, startTime: "12:00", endTime: "15:00" },
  ];
  const errors = validateAvailabilityBlocks(blocks);
  assert.deepEqual(
    errors.filter((e) => e.field === "blocks"),
    []
  );
});

test("validateAvailabilityBlocks: same time range on DIFFERENT days -> NOT flagged as overlap", () => {
  const blocks: AvailabilityBlockInput[] = [
    { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
    { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
  ];
  const errors = validateAvailabilityBlocks(blocks);
  assert.deepEqual(
    errors.filter((e) => e.field === "blocks"),
    []
  );
});

test("validateAvailabilityBlocks: does not attempt overlap detection on invalid blocks", () => {
  // Both blocks are individually invalid (bad time format) -- overlap
  // detection should not throw or produce spurious "blocks" overlap errors
  // for blocks that never passed individual validation.
  const blocks: AvailabilityBlockInput[] = [
    { dayOfWeek: 1, startTime: "bad", endTime: "worse" },
    { dayOfWeek: 1, startTime: "also-bad", endTime: "still-bad" },
  ];
  const errors = validateAvailabilityBlocks(blocks);
  assert.deepEqual(
    errors.filter((e) => e.field === "blocks"),
    []
  );
});

test("validateAvailabilityBlocks: empty array -> no errors", () => {
  assert.deepEqual(validateAvailabilityBlocks([]), []);
});

// ---------------------------------------------------------------------------
// Mock Supabase client for setCandidateAvailability / getCandidateAvailability
// ---------------------------------------------------------------------------

interface AvailabilityRow {
  id: string;
  candidate_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

function makeMockClient(initialRows: AvailabilityRow[] = []) {
  let rows = [...initialRows];
  let nextId = 1;

  return {
    _rows: () => rows,
    from(table: string) {
      assert.equal(table, "candidate_availability");
      return {
        delete() {
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "candidate_id");
              rows = rows.filter((r) => r.candidate_id !== value);
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(newRows: Array<{ candidate_id: string; day_of_week: number; start_time: string; end_time: string }>) {
          const inserted = newRows.map((r) => ({ id: `row-${nextId++}`, ...r }));
          rows.push(...inserted);
          return {
            select(_cols: string) {
              return Promise.resolve({
                data: inserted.map((r) => ({ id: r.id })),
                error: null,
              });
            },
          };
        },
        select(_cols: string) {
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "candidate_id");
              const filtered = rows.filter((r) => r.candidate_id === value);
              return {
                order(field1: string, _opts1: unknown) {
                  return {
                    order(field2: string, _opts2: unknown) {
                      const sorted = [...filtered].sort((a, b) => {
                        if (field1 === "day_of_week" && a.day_of_week !== b.day_of_week) {
                          return a.day_of_week - b.day_of_week;
                        }
                        if (field2 === "start_time") {
                          return a.start_time.localeCompare(b.start_time);
                        }
                        return 0;
                      });
                      return Promise.resolve({ data: sorted, error: null });
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

// ---------------------------------------------------------------------------
// setCandidateAvailability
// ---------------------------------------------------------------------------

test("setCandidateAvailability: invalid blocks -> throws AvailabilityValidationError, never touches DB", async () => {
  const client = makeMockClient([
    { id: "existing-1", candidate_id: "cand-1", day_of_week: 1, start_time: "09:00", end_time: "10:00" },
  ]);

  await assert.rejects(
    () =>
      setCandidateAvailability(
        "cand-1",
        [{ dayOfWeek: 9, startTime: "09:00", endTime: "10:00" }],
        client
      ),
    AvailabilityValidationError
  );

  // DB untouched: the pre-existing row should still be there.
  assert.equal(client._rows().length, 1);
});

test("setCandidateAvailability: valid blocks -> replaces existing rows and returns count", async () => {
  const client = makeMockClient([
    { id: "existing-1", candidate_id: "cand-1", day_of_week: 0, start_time: "08:00", end_time: "09:00" },
    { id: "existing-2", candidate_id: "cand-2", day_of_week: 0, start_time: "08:00", end_time: "09:00" },
  ]);

  const result = await setCandidateAvailability(
    "cand-1",
    [
      { dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
      { dayOfWeek: 2, startTime: "13:00", endTime: "15:00" },
    ],
    client
  );

  assert.equal(result.count, 2);

  const rows = client._rows();
  // cand-2's untouched row should still exist.
  assert.ok(rows.some((r: AvailabilityRow) => r.candidate_id === "cand-2"));
  // cand-1's old row should be gone, replaced by the 2 new ones.
  assert.equal(rows.filter((r: AvailabilityRow) => r.candidate_id === "cand-1").length, 2);
});

test("setCandidateAvailability: empty blocks array -> clears availability, count 0", async () => {
  const client = makeMockClient([
    { id: "existing-1", candidate_id: "cand-1", day_of_week: 1, start_time: "09:00", end_time: "10:00" },
  ]);

  const result = await setCandidateAvailability("cand-1", [], client);
  assert.equal(result.count, 0);
  assert.equal(client._rows().filter((r: AvailabilityRow) => r.candidate_id === "cand-1").length, 0);
});

// ---------------------------------------------------------------------------
// getCandidateAvailability
// ---------------------------------------------------------------------------

test("getCandidateAvailability: returns blocks sorted by dayOfWeek then startTime", async () => {
  const client = makeMockClient([
    { id: "r1", candidate_id: "cand-1", day_of_week: 2, start_time: "09:00:00", end_time: "10:00:00" },
    { id: "r2", candidate_id: "cand-1", day_of_week: 1, start_time: "13:00:00", end_time: "14:00:00" },
    { id: "r3", candidate_id: "cand-1", day_of_week: 1, start_time: "09:00:00", end_time: "10:00:00" },
  ]);

  const result = await getCandidateAvailability("cand-1", client);

  assert.deepEqual(result, [
    { dayOfWeek: 1, startTime: "09:00", endTime: "10:00" },
    { dayOfWeek: 1, startTime: "13:00", endTime: "14:00" },
    { dayOfWeek: 2, startTime: "09:00", endTime: "10:00" },
  ]);
});

test("getCandidateAvailability: candidate with no rows -> empty array", async () => {
  const client = makeMockClient([]);
  const result = await getCandidateAvailability("cand-nobody", client);
  assert.deepEqual(result, []);
});
