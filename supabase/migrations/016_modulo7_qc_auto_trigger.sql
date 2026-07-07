-- Migración: Módulo 7 — Trigger automático para qc_reviews al completar servicio

-- Trigger: cuando una orden se marca como 'completed', crear qc_review automáticamente
-- Si el empleado asignado es 'elite', status = 'auto'; de lo contrario, 'pending'

CREATE OR REPLACE FUNCTION trigger_create_qc_review_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_employee_id UUID;
  v_trust_level TEXT;
  v_qc_status TEXT;
BEGIN
  -- Solo actuar cuando el status cambia a 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    -- Obtener el empleado asignado a esta orden
    SELECT employee_id INTO v_employee_id
    FROM assignments
    WHERE order_id = NEW.id
    ORDER BY assigned_at DESC
    LIMIT 1;

    -- Si no hay asignación, no crear qc_review
    IF v_employee_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Obtener trust_level del empleado
    SELECT trust_level INTO v_trust_level
    FROM employees
    WHERE id = v_employee_id;

    -- Determinar status de qc_review
    IF v_trust_level = 'elite' THEN
      v_qc_status := 'auto';
    ELSE
      v_qc_status := 'pending';
    END IF;

    -- Insertar qc_review (ignorar si ya existe por UNIQUE(order_id))
    INSERT INTO qc_reviews (order_id, employee_id, status, sampling_reason)
    VALUES (NEW.id, v_employee_id, v_qc_status, 
      CASE WHEN v_qc_status = 'auto' THEN 'Elite auto-approval' ELSE NULL END)
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_qc_review_trigger ON orders;
CREATE TRIGGER create_qc_review_trigger
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trigger_create_qc_review_on_complete();
