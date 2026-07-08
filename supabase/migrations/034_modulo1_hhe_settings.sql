-- Migración Módulo 1: tabla de HHE editable por admin
-- Cada fila representa una celda vigente de la tabla 4×5.

CREATE TABLE IF NOT EXISTS hhe_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT NOT NULL CHECK (service_type IN ('regular', 'deep', 'move_in_out', 'post_construction')),
  range_index INTEGER NOT NULL CHECK (range_index BETWEEN 0 AND 4),
  hhe_value NUMERIC(5,2) NOT NULL CHECK (hhe_value > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_type, range_index, effective_from)
);

COMMENT ON TABLE hhe_settings IS 'Horas-Hombre Estimadas editables por admin (20 celdas: 4 tipos × 5 rangos de ft²)';

-- Índice para leer la fila vigente de cada celda
CREATE INDEX IF NOT EXISTS idx_hhe_settings_lookup
  ON hhe_settings(service_type, range_index, effective_from)
  WHERE effective_to IS NULL;

-- Función para obtener la tabla HHE vigente
CREATE OR REPLACE FUNCTION get_current_hhe_table()
RETURNS TABLE(service_type TEXT, range_index INTEGER, hhe_value NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (h.service_type, h.range_index)
    h.service_type, h.range_index, h.hhe_value
  FROM hhe_settings h
  WHERE h.effective_to IS NULL
  ORDER BY h.service_type, h.range_index, h.effective_from DESC;
$$;

-- Poblar valores default derivados de $70/hr (v8.2)
INSERT INTO hhe_settings (service_type, range_index, hhe_value, reason)
VALUES
  ('regular', 0, 1.5, 'Default v8.2'),
  ('regular', 1, 2.5, 'Default v8.2'),
  ('regular', 2, 4.0, 'Default v8.2'),
  ('regular', 3, 6.0, 'Default v8.2'),
  ('regular', 4, 8.0, 'Default v8.2'),
  ('deep', 0, 2.5, 'Default v8.2'),
  ('deep', 1, 4.0, 'Default v8.2'),
  ('deep', 2, 6.5, 'Default v8.2'),
  ('deep', 3, 9.0, 'Default v8.2'),
  ('deep', 4, 12.0, 'Default v8.2'),
  ('move_in_out', 0, 3.0, 'Default v8.2'),
  ('move_in_out', 1, 5.0, 'Default v8.2'),
  ('move_in_out', 2, 8.0, 'Default v8.2'),
  ('move_in_out', 3, 11.0, 'Default v8.2'),
  ('move_in_out', 4, 15.0, 'Default v8.2'),
  ('post_construction', 0, 4.0, 'Default v8.2'),
  ('post_construction', 1, 6.5, 'Default v8.2'),
  ('post_construction', 2, 10.0, 'Default v8.2'),
  ('post_construction', 3, 14.0, 'Default v8.2'),
  ('post_construction', 4, 18.0, 'Default v8.2')
ON CONFLICT (service_type, range_index, effective_from) DO NOTHING;
