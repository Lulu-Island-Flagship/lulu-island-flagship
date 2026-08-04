-- Fix: M12 [MEDIUM] Fix ON DELETE CASCADE on employee_low_score_streaks
-- The FK employee_low_score_streaks.employee_id -> employees.id uses
-- ON DELETE CASCADE (193_e5_low_score_streak.sql). This means deleting an
-- employee silently deletes their low-score streak records, losing
-- documented causal evidence required for termination decisions.
-- Changed to ON DELETE RESTRICT to prevent accidental data loss.

ALTER TABLE employee_low_score_streaks
  DROP CONSTRAINT IF EXISTS employee_low_score_streaks_employee_id_fkey;

ALTER TABLE employee_low_score_streaks
  ADD CONSTRAINT employee_low_score_streaks_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
