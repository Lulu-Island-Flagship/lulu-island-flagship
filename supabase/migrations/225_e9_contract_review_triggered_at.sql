-- v8.3 E9.8 — fix de auditoría: isContractReviewDue() usaba `===` de fecha
-- exacta (día 60 antes del aniversario, un único día del año). Si el cron
-- diario (contract-review-scan) se saltaba ese día específico por cualquier
-- motivo, el contrato nunca disparaba revisión legal ese ciclo, en
-- silencio. Se cambió a un rango (0, 60] días -- ver
-- src/lib/contract-review.ts isContractReviewDue.
--
-- Ese rango cubre 60 corridas diarias del cron por contrato/aniversario, así
-- que se necesita una guarda explícita para no re-disparar (o reintentar
-- innecesariamente) cada día dentro de la misma ventana. `review_triggered_at`
-- guarda CUÁNDO se disparó la última revisión y, junto con
-- `review_triggered_for_anniversary`, PARA QUÉ aniversario -- así el cron
-- compara el aniversario objetivo de hoy contra el ya disparado y sabe si
-- ya cubrió esta ventana (ver wasReviewAlreadyTriggeredForAnniversary en
-- contract-review.ts).

ALTER TABLE service_contracts
  ADD COLUMN IF NOT EXISTS review_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_triggered_for_anniversary DATE;

CREATE INDEX IF NOT EXISTS idx_service_contracts_review_triggered
  ON service_contracts(review_triggered_for_anniversary);
