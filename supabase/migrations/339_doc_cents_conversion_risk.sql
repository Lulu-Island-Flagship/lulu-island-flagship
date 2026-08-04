-- Fix: R6 [HIGH - Documentation] Document cents conversion risk
-- Fix: M8 [MEDIUM - Documentation] Document DROP CASCADE safeguards
--
-- R6: Migration 229 (raiz3_orders_money_columns_to_cents) performs an
-- in-place UPDATE that multiplies dollar values by 100, followed by column
-- renames. This pattern is risky because:
--   1. If the migration is ever re-run (idempotency edge case), the
--      multiplication would be applied a second time, producing wildly
--      incorrect values (e.g., $100 -> 10000 cents -> 1000000 "cents").
--   2. The UPDATE runs across ALL rows in the orders table. On large
--      tables, this could hold a lock for an extended period.
--   3. The WHERE clause uses IS NOT NULL checks that may not catch all
--      rows (the columns are NOT NULL DEFAULT 0, but the intent to guard
--      against re-running is implicit rather than explicit).
--
-- Recommendation: For any future currency-unit migrations, use a sentinel
-- or idempotent guard (e.g., add a temporary column, set a configuration
-- flag, or use a PL/pgSQL function with an explicit version check) so the
-- conversion cannot be accidentally re-applied. Batch large UPDATEs by
-- LIMIT/OFFSET if the table may have millions of rows.

DO $$
BEGIN
  RAISE NOTICE 'R6 DOC: Migration 229 (raiz3_orders_money_columns_to_cents) converts orders monetary columns from dollars to cents via UPDATE x100 + RENAME. This pattern is not idempotent — re-running it would multiply values by 100 again. For any future currency-unit conversions, add an explicit guard (sentinel column or version flag). Also batch large UPDATEs if the table may grow large.';
END;
$$;

-- M8: DROP CASCADE is used in some migrations (e.g., 329_fix_pipeda_deletion_cascade_atomic).
-- DROP CASCADE silently removes dependent objects (views, triggers, FKs)
-- which can cause data loss or break application code without warning.
--
-- Recommendation: Before any DROP CASCADE, query pg_depend to understand
-- exactly what will be dropped:
--
--   SELECT objid::regclass, deptype
--   FROM pg_depend
--   WHERE refobjid = '<target_table>'::regclass;
--
-- This should be included in the migration as a comment or as a guard
-- that raises an exception if unexpected dependents exist.

DO $$
BEGIN
  RAISE NOTICE 'M8 DOC: DROP CASCADE silently removes dependent objects. Before using it, query pg_depend to list dependents and verify no unintended objects will be dropped. Example: SELECT objid::regclass, deptype FROM pg_depend WHERE refobjid = ''<table>''::regclass;';
END;
$$;
