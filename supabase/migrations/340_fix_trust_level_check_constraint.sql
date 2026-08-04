-- Migración 340 — Fix: trust_level CHECK constraint missing 'probation'.
--
-- BUG: Migration 011 created employees.trust_level with CHECK IN
-- ('elite','standard','observation','suspended'). Migration 026 attempted
-- to add the same column with CHECK IN ('elite','standard','probation'),
-- but used ADD COLUMN IF NOT EXISTS, so its constraint never took effect.
-- Code expecting 'probation' (e.g. recalculate_weekly_score, dispatch
-- team builder) fails against 011's narrower constraint.
--
-- This migration drops the existing constraint and re-adds it with the
-- full union of values from both 011 and 026.

ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_trust_level_check;

ALTER TABLE employees
  ADD CONSTRAINT employees_trust_level_check
    CHECK (trust_level IN ('elite', 'standard', 'observation', 'suspended', 'probation'));
