-- v8.3 E5 (Sesión Q) — Resolución de disputa vs. evidencia fotográfica de cierre
-- Dueño del módulo: E5 (garantía/disputas). Lee: E4 (service_checklist_items /
-- sop_checklists, 006_modulo4_checklist_tables.sql), Sesión G
-- (batch-capture-eligibility.ts / severity, 080), Sesión H (dispatch_communication /
-- evento 'dispute_resolved', 084), tickets_disputas (010_modulo7_qc_score_tables.sql).
--
-- Contexto (invariante B.2.2): "La garantía es RELACIONAL A EVIDENCIA
-- fotográfica, no a reloj: los reclamos se resuelven comparando contra la
-- foto de cierre de la zona específica." Hasta ahora `evaluateCaptureEligibility`
-- (Sesión G) solo decidía si el reclamo excluye el cobro del Batch — nunca
-- existió una comparación estructurada entre la foto de cierre de la zona y
-- la evidencia que aporta el cliente, ni una decisión sobre el reclamo en sí
-- (re-limpieza vs. explicación). src/lib/warranty-dispute-resolution.ts
-- implementa esa comparación como función pura; esta migración solo agrega
-- las columnas donde persistir su resultado. Mismo patrón que
-- exPostReviewOutcome en safety-abort.ts: la evidencia informa, un humano
-- decide, salvo el caso obvio (falta de evidencia del lado de la empresa)
-- que sí resuelve automáticamente a favor del cliente.
--
-- No se crea tabla nueva: warranty_claims (020) y warranty_photo_evidence (020)
-- ya alcanzan; la tarea de re-limpieza para el equipo se encola reutilizando
-- tickets_disputas (mismo patrón que 080_e2_batch_capture_dispute_exclusion.sql),
-- no se inventa una cola paralela.

-- ============================================================
-- 1. Columnas de decisión en warranty_claims
-- ============================================================
ALTER TABLE warranty_claims
  ADD COLUMN IF NOT EXISTS claim_zone TEXT,
  ADD COLUMN IF NOT EXISTS decision_outcome TEXT
    CHECK (decision_outcome IN (
      'auto_favor_client_missing_closure_evidence',
      'auto_favor_team_unsubstantiated_claim',
      'requires_human_review_contradictory_evidence'
    )),
  ADD COLUMN IF NOT EXISTS requires_human_review BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS final_action TEXT
    CHECK (final_action IN ('free_recleaning', 'explain_no_action', 'dismiss'));

COMMENT ON COLUMN warranty_claims.claim_zone IS
  'Zona del reclamo del cliente (mismo vocabulario que sop_checklists.zone: '
  'bathroom, kitchen, living, bedroom, floor, windows, general). Se usa para '
  'buscar la foto de cierre de esa zona específica en service_checklist_items '
  '(B.2.2: comparación contra evidencia, no contra reloj).';

COMMENT ON COLUMN warranty_claims.decision_outcome IS
  'Resultado de evaluateWarrantyDisputeResolution (src/lib/warranty-dispute-resolution.ts). '
  'auto_favor_client_missing_closure_evidence: no hay foto de cierre de la zona, '
  'falta de evidencia del lado de la empresa, se resuelve solo. '
  'auto_favor_team_unsubstantiated_claim: hay foto de cierre y el cliente no '
  'aportó evidencia propia, reclamo sin respaldo, se resuelve con explicación. '
  'requires_human_review_contradictory_evidence: ambas partes aportaron '
  'evidencia para la misma zona, un humano decide (patrón exPostReviewOutcome).';

CREATE INDEX IF NOT EXISTS idx_warranty_claims_requires_review
  ON warranty_claims(order_id)
  WHERE status = 'open' AND requires_human_review = true;

-- ============================================================
-- 2. tickets_disputas ya acepta type='dispute' desde 010; se agrega la razón
-- de contexto estándar 'warranty_recleaning_required' para que el admin la
-- reconozca en la bandeja unificada. No se altera el CHECK existente. El
-- campo context (JSONB) lleva: { warranty_claim_id, order_id, zone }.
-- ============================================================
