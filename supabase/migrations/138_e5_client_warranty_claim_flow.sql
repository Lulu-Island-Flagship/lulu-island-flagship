-- Migración 138 — v8.3 E5: el cliente puede presentar un reclamo de garantía
--
-- Contexto (auditoría 2026-07-13): warranty_claims (020) y la resolución
-- contra evidencia fotográfica de cierre (124, src/lib/warranty-dispute-resolution.ts)
-- ya estaban construidas y probadas, pero NUNCA se disparaban en la práctica:
-- no existía ninguna ruta ni pantalla donde el cliente pudiera crear un
-- warranty_claim. La política RLS de INSERT en warranty_claims (020) sí
-- permitía al cliente crear su propio reclamo desde el día 1 -- lo que
-- faltaba era: (a) permiso para subir SU PROPIA evidencia fotográfica
-- (warranty_photo_evidence solo aceptaba INSERT de supervisores), y (b) el
-- endpoint/pantalla en sí (fuera del alcance de una migración).
--
-- ============================================================
-- 1. Permitir que el cliente inserte SU PROPIA evidencia (photo_type='client')
--    solo en reclamos que le pertenecen.
-- ============================================================
DROP POLICY IF EXISTS "Clients insert own warranty evidence" ON warranty_photo_evidence;
CREATE POLICY "Clients insert own warranty evidence" ON warranty_photo_evidence
  FOR INSERT WITH CHECK (
    photo_type = 'client'
    AND warranty_claim_id IN (SELECT id FROM warranty_claims WHERE user_id = auth.uid())
  );

-- ============================================================
-- 2. Guarda de integridad: nunca dos reclamos ABIERTOS para la misma
--    orden+zona (evita que el cliente duplique el mismo reclamo por error o
--    para forzar cola; no es una regla de negocio nueva, es una restricción
--    estructural -- un segundo reclamo real sobre la misma zona debe
--    reabrir/comentar el existente, no crear uno paralelo).
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_warranty_claims_no_duplicate_open
  ON warranty_claims (order_id, claim_zone)
  WHERE status = 'open' AND claim_zone IS NOT NULL;

-- ============================================================
-- 3. El cliente necesita saber QUÉ ZONAS se limpiaron en su orden para
--    poder elegir una al presentar un reclamo (GET /api/client/orders). No
--    existía ninguna policy de lectura para clientes en
--    service_checklist_items -- la ruta ya limita las columnas que pide
--    (nunca photo_url), pero sin esta policy RLS bloquea la fila entera.
-- ============================================================
DROP POLICY IF EXISTS "Clients read own service checklist items" ON service_checklist_items;
CREATE POLICY "Clients read own service checklist items" ON service_checklist_items
  FOR SELECT USING (
    order_id IN (SELECT id FROM orders WHERE user_id = auth.uid())
  );

-- El join anterior también toca sop_checklists (zone, zone_label) -- el
-- catálogo de zonas en sí (D.7: "kitchen", "bathroom", ...) no es
-- información sensible, es la misma nomenclatura que ya aparece en el
-- cotizador público (addon-zones). Sin esta policy, RLS bloquea el join
-- aunque service_checklist_items sí sea legible.
DROP POLICY IF EXISTS "Clients read active checklists" ON sop_checklists;
CREATE POLICY "Clients read active checklists" ON sop_checklists
  FOR SELECT USING (is_active = true);

COMMENT ON POLICY "Clients insert own warranty evidence" ON warranty_photo_evidence IS
  'v8.3 E5 (2026-07-13): cierra el hueco que dejaba huérfana toda la máquina de '
  'evaluateWarrantyDisputeResolution -- el cliente por fin puede aportar su propia '
  'evidencia, no solo el equipo/auditor.';
