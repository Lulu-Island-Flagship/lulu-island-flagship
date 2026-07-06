-- Tablas para Módulo 4 — Ejecución Física (Checklist estructurado)
-- Ejecutar en SQL Editor de Supabase

-- ============================================================
-- 1. Tabla sop_checklists (plantilla de checklist por tipo de servicio)
-- ============================================================
CREATE TABLE IF NOT EXISTS sop_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_subtype TEXT NOT NULL, -- "first_time", "regular", "move_in_out", "office", "airbnb", "post_construction"
  zone TEXT NOT NULL,            -- "bathroom", "kitchen", "living", "bedroom", "floor", "windows", "general"
  zone_label TEXT NOT NULL,      -- "Baño", "Cocina", "Sala", "Dormitorio", "Piso", "Ventanas", "General"
  zone_color TEXT NOT NULL,      -- "red", "blue", "green", "yellow", "white", "black"
  zone_icon TEXT NOT NULL,       -- Emoji o nombre de ícono
  items JSONB NOT NULL,          -- [{"id":"b1","label":"Inodoro desinfectado","required":true}, ...]
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para buscar checklist por tipo de servicio
CREATE INDEX IF NOT EXISTS idx_sop_checklists_subtype ON sop_checklists(service_subtype);
CREATE INDEX IF NOT EXISTS idx_sop_checklists_zone ON sop_checklists(zone);

ALTER TABLE sop_checklists ENABLE ROW LEVEL SECURITY;

-- Empleados pueden leer checklists activos
CREATE POLICY "Employees read active checklists" ON sop_checklists
  FOR SELECT USING (is_active = true);

-- Supervisores pueden gestionar checklists
CREATE POLICY "Supervisors manage checklists" ON sop_checklists
  FOR ALL USING (is_supervisor(auth.uid()));

-- ============================================================
-- 2. Tabla service_checklist_items (respuestas del empleado por servicio)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  checklist_id UUID NOT NULL REFERENCES sop_checklists(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,         -- ID del ítem dentro del JSONB de sop_checklists
  item_label TEXT NOT NULL,      -- Label del ítem (denormalizado para consultas rápidas)
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  photo_url TEXT,                -- Foto opcional de evidencia del ítem
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_checklist_items_order ON service_checklist_items(order_id);
CREATE INDEX IF NOT EXISTS idx_service_checklist_items_employee ON service_checklist_items(employee_id);
CREATE INDEX IF NOT EXISTS idx_service_checklist_items_checklist ON service_checklist_items(checklist_id);

ALTER TABLE service_checklist_items ENABLE ROW LEVEL SECURITY;

-- Empleados pueden leer/escribir sus propios checklist items
CREATE POLICY "Employees read own checklist items" ON service_checklist_items
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Employees insert own checklist items" ON service_checklist_items
  FOR INSERT WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Employees update own checklist items" ON service_checklist_items
  FOR UPDATE USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

-- Supervisores pueden ver todos los checklist items
CREATE POLICY "Supervisors read all checklist items" ON service_checklist_items
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 3. Tabla service_upsells (registro de upsells propuestos, solo informativo)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_upsells (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  upsell_type TEXT NOT NULL,     -- "fridge", "oven", "interior_windows", "carpets", "other"
  upsell_label TEXT NOT NULL,    -- "Nevera +$45", "Horno +$35", etc.
  amount INTEGER NOT NULL,       -- Monto en CAD (informativo, no afecta cobro)
  client_approved BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_upsells_order ON service_upsells(order_id);
CREATE INDEX IF NOT EXISTS idx_service_upsells_employee ON service_upsells(employee_id);

ALTER TABLE service_upsells ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees read own upsells" ON service_upsells
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Employees insert own upsells" ON service_upsells
  FOR INSERT WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );

CREATE POLICY "Supervisors read all upsells" ON service_upsells
  FOR SELECT USING (is_supervisor(auth.uid()));

-- ============================================================
-- 4. Datos de ejemplo: checklist para "first_time" (Deep Cleaning)
-- ============================================================
INSERT INTO sop_checklists (service_subtype, zone, zone_label, zone_color, zone_icon, items, sort_order)
VALUES
  ('first_time', 'bathroom', 'Baño', 'red', '🚽', '[
    {"id":"b1","label":"Inodoro desinfectado (interior y exterior)","required":true},
    {"id":"b2","label":"Lavamanos y grifos limpios y brillantes","required":true},
    {"id":"b3","label":"Espejo sin manchas","required":true},
    {"id":"b4","label":"Ducha/bañera: jabón y moho removido","required":true},
    {"id":"b5","label":"Toallas dobladas o colgadas ordenadas","required":false},
    {"id":"b6","label":"Piso limpio y seco","required":true}
  ]', 1),
  ('first_time', 'kitchen', 'Cocina', 'blue', '🍳', '[
    {"id":"k1","label":"Campana extractora desengrasada","required":true},
    {"id":"k2","label":"Estufa y horno limpios (exterior)","required":true},
    {"id":"k3","label":"Microondas limpio (interior y exterior)","required":true},
    {"id":"k4","label":"Refrigerador exterior limpio","required":true},
    {"id":"k5","label":"Encimeras desinfectadas","required":true},
    {"id":"k6","label":"Fregadero limpio y desinfectado","required":true},
    {"id":"k7","label":"Piso limpio y seco","required":true}
  ]', 2),
  ('first_time', 'living', 'Sala / Áreas comunes', 'green', '✨', '[
    {"id":"l1","label":"Polvo removido de superficies","required":true},
    {"id":"l2","label":"Muebles limpios y ordenados","required":true},
    {"id":"l3","label":"Espejos y vidrios limpios","required":true},
    {"id":"l4","label":"Basura retirada","required":true},
    {"id":"l5","label":"Piso aspirado y trapeado","required":true}
  ]', 3),
  ('first_time', 'bedroom', 'Dormitorios', 'green', '✨', '[
    {"id":"r1","label":"Cama tendida (o cambio de sábanas si aplica)","required":true},
    {"id":"r2","label":"Polvo removido de superficies","required":true},
    {"id":"r3","label":"Espejos limpios","required":true},
    {"id":"r4","label":"Piso aspirado y trapeado","required":true}
  ]', 4),
  ('first_time', 'floor', 'Pisos generales', 'black', '🧹', '[
    {"id":"f1","label":"Todos los pisos aspirados","required":true},
    {"id":"f2","label":"Todos los pisos trapeados/mopeados","required":true},
    {"id":"f3","label":"Zócalos limpios","required":false}
  ]', 5),
  ('first_time', 'windows', 'Ventanas', 'white', '🪟', '[
    {"id":"w1","label":"Vidrios interiores limpios","required":false},
    {"id":"w2","label":"Marcos y rieles libres de polvo","required":false}
  ]', 6)
ON CONFLICT DO NOTHING;

-- Checklist para "regular" (Regular Cleaning) — más ligero
INSERT INTO sop_checklists (service_subtype, zone, zone_label, zone_color, zone_icon, items, sort_order)
VALUES
  ('regular', 'bathroom', 'Baño', 'red', '🚽', '[
    {"id":"b1","label":"Inodoro desinfectado","required":true},
    {"id":"b2","label":"Lavamanos y grifos limpios","required":true},
    {"id":"b3","label":"Espejo sin manchas","required":true},
    {"id":"b4","label":"Piso limpio y seco","required":true}
  ]', 1),
  ('regular', 'kitchen', 'Cocina', 'blue', '🍳', '[
    {"id":"k1","label":"Estufa exterior limpia","required":true},
    {"id":"k2","label":"Encimeras desinfectadas","required":true},
    {"id":"k3","label":"Fregadero limpio","required":true},
    {"id":"k4","label":"Piso limpio y seco","required":true}
  ]', 2),
  ('regular', 'living', 'Sala / Áreas comunes', 'green', '✨', '[
    {"id":"l1","label":"Polvo removido","required":true},
    {"id":"l2","label":"Muebles ordenados","required":true},
    {"id":"l3","label":"Piso limpio","required":true}
  ]', 3),
  ('regular', 'bedroom', 'Dormitorios', 'green', '✨', '[
    {"id":"r1","label":"Cama tendida","required":true},
    {"id":"r2","label":"Polvo removido","required":true},
    {"id":"r3","label":"Piso limpio","required":true}
  ]', 4)
ON CONFLICT DO NOTHING;

-- Checklist para "move_in_out" (Move In/Out)
INSERT INTO sop_checklists (service_subtype, zone, zone_label, zone_color, zone_icon, items, sort_order)
VALUES
  ('move_in_out', 'bathroom', 'Baño', 'red', '🚽', '[
    {"id":"b1","label":"Inodoro desinfectado a fondo","required":true},
    {"id":"b2","label":"Lavamanos, grifos y ducha brillantes","required":true},
    {"id":"b3","label":"Azulejos y juntas limpias","required":true},
    {"id":"b4","label":"Gabinetes interiores limpios","required":true},
    {"id":"b5","label":"Piso limpio y seco","required":true}
  ]', 1),
  ('move_in_out', 'kitchen', 'Cocina', 'blue', '🍳', '[
    {"id":"k1","label":"Campana y estufa desengrasadas","required":true},
    {"id":"k2","label":"Horno limpio (interior y exterior)","required":true},
    {"id":"k3","label":"Refrigerador limpio (interior y exterior)","required":true},
    {"id":"k4","label":"Gabinetes interiores limpios","required":true},
    {"id":"k5","label":"Encimeras y fregadero desinfectados","required":true},
    {"id":"k6","label":"Piso limpio y seco","required":true}
  ]', 2),
  ('move_in_out', 'living', 'Sala / Áreas comunes', 'green', '✨', '[
    {"id":"l1","label":"Polvo removido de todas las superficies","required":true},
    {"id":"l2","label":"Muebles limpios","required":true},
    {"id":"l3","label":"Paredes limpias (manchas leves)","required":false},
    {"id":"l4","label":"Piso limpio y seco","required":true}
  ]', 3),
  ('move_in_out', 'bedroom', 'Dormitorios', 'green', '✨', '[
    {"id":"r1","label":"Closets interiores limpios","required":true},
    {"id":"r2","label":"Polvo removido","required":true},
    {"id":"r3","label":"Piso limpio y seco","required":true}
  ]', 4),
  ('move_in_out', 'floor', 'Pisos generales', 'black', '🧹', '[
    {"id":"f1","label":"Todos los pisos aspirados y trapeados","required":true},
    {"id":"f2","label":"Zócalos limpios","required":true}
  ]', 5),
  ('move_in_out', 'windows', 'Ventanas', 'white', '🪟', '[
    {"id":"w1","label":"Vidrios interiores limpios","required":true},
    {"id":"w2","label":"Marcos y rieles limpios","required":true}
  ]', 6)
ON CONFLICT DO NOTHING;
