-- Migración 346: Aplica el fix de payment_failure al constraint tickets_disputas_type_check
-- La migración 089 original se modificó en el repo pero ya estaba marcada como aplicada en producción.
-- Este archivo aplica el fix como nueva migración para que db push lo ejecute.

-- Problema: 073 agregó 'payment_failure', 089 lo borró al recrear el constraint
-- Fix: recrear el constraint con TODOS los valores acumulados
ALTER TABLE tickets_disputas DROP CONSTRAINT IF EXISTS tickets_disputas_type_check;
ALTER TABLE tickets_disputas ADD CONSTRAINT tickets_disputas_type_check
  CHECK (type IN ('dispute', 'discrepancy', 'consulta', 'payment_failure', 'wellbeing_no_backup'));
