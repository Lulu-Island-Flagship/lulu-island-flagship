-- Migración: funciones RPC para verificar historial de checklists (Módulo 11 — Borrado seguro)

-- ============================================================
-- 1. Verificar si un service_subtype tiene historial
-- ============================================================
CREATE OR REPLACE FUNCTION check_service_type_history(p_service_subtype TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM service_checklist_items sci
    JOIN sop_checklists sc ON sc.id = sci.checklist_id
    WHERE sc.service_subtype = p_service_subtype
  );
END;
$$;

-- ============================================================
-- 2. Verificar si una zona específica (checklist_id) tiene historial
-- ============================================================
CREATE OR REPLACE FUNCTION check_zone_history(p_checklist_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM service_checklist_items
    WHERE checklist_id = p_checklist_id
  );
END;
$$;

-- ============================================================
-- 3. Verificar si un ítem específico (item_id + checklist_id) tiene historial
-- ============================================================
CREATE OR REPLACE FUNCTION check_item_history(p_item_id TEXT, p_checklist_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM service_checklist_items
    WHERE item_id = p_item_id AND checklist_id = p_checklist_id
  );
END;
$$;
