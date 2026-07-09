-- Migración 048 — v8.3 E7: estructura de inventario, proveedores, órdenes de
-- compra, ciclo de paños y manejo de llaves.
--
-- IMPORTANTE: esta migración crea la ESTRUCTURA vacía a propósito. No inserta
-- proveedores, precios ni productos reales — esos son datos del negocio de
-- Aeon y deben cargarse desde el admin (o un CSV), no inventados por el
-- asistente. El objetivo es que la app ya tenga dónde guardar esa
-- información en cuanto exista.

-- ============================================================
-- 1. Proveedores
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  lead_time_days INTEGER NOT NULL DEFAULT 3,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage suppliers" ON suppliers;
CREATE POLICY "Supervisors manage suppliers" ON suppliers
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON suppliers;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 2. Productos de inventario (consumibles: químicos, paños, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('chemical', 'cloth', 'ppe', 'equipment', 'other')),
  unit TEXT NOT NULL DEFAULT 'unit', -- 'L', 'unit', 'box', etc.
  current_stock NUMERIC NOT NULL DEFAULT 0,
  reorder_threshold NUMERIC NOT NULL DEFAULT 0,
  -- Consumo estimado por tipo de servicio, ej: {"deep": 0.3, "regular": 0.1} (unidades por servicio)
  consumption_per_service JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage inventory items" ON inventory_items;
CREATE POLICY "Supervisors manage inventory items" ON inventory_items
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Employees read inventory items" ON inventory_items;
CREATE POLICY "Employees read inventory items" ON inventory_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS trg_prevent_delete ON inventory_items;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 3. Catálogo proveedor x producto, con precio histórico
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  unit_price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_item ON supplier_catalog(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_supplier ON supplier_catalog(supplier_id);
-- Solo un precio "vigente" por combinación proveedor+producto a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_catalog_current
  ON supplier_catalog(supplier_id, inventory_item_id)
  WHERE is_current = true;

ALTER TABLE supplier_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage supplier catalog" ON supplier_catalog;
CREATE POLICY "Supervisors manage supplier catalog" ON supplier_catalog
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON supplier_catalog;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON supplier_catalog
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 4. Órdenes de compra (D.7.6): stock < umbral -> PO generada -> aprobación
--    de un toque -> recordatorio 48h -> alerta stock-out 72h.
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'ordered', 'received', 'cancelled')),
  generated_reason TEXT, -- ej: "stock de Desengrasante bajo umbral (2L < 5L)"
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  ordered_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ, -- recordatorio 48h
  stockout_alert_sent_at TIMESTAMPTZ, -- alerta 72h
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage purchase orders" ON purchase_orders;
CREATE POLICY "Supervisors manage purchase orders" ON purchase_orders
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON purchase_orders;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
  quantity NUMERIC NOT NULL,
  unit_price_cents INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(purchase_order_id);

ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage PO lines" ON purchase_order_lines;
CREATE POLICY "Supervisors manage PO lines" ON purchase_order_lines
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON purchase_order_lines;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 5. Punto logístico — ciclo de paños (D.7.3): conteo por COLOR, nunca por
--    unidad. limpio -> usado -> sucio -> lavado -> bodega -> vehículo.
-- ============================================================
CREATE TABLE IF NOT EXISTS towel_cycle_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  color TEXT NOT NULL
    CHECK (color IN ('red', 'blue', 'green', 'yellow', 'white', 'black')),
  stage TEXT NOT NULL
    CHECK (stage IN ('clean', 'in_use', 'dirty', 'washing', 'warehouse', 'vehicle')),
  count INTEGER NOT NULL CHECK (count >= 0),
  vehicle_id UUID REFERENCES vehicles(id),
  recorded_by UUID REFERENCES employees(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_towel_cycle_color_stage ON towel_cycle_log(color, stage);
CREATE INDEX IF NOT EXISTS idx_towel_cycle_recorded ON towel_cycle_log(recorded_at);

ALTER TABLE towel_cycle_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Employees insert towel cycle" ON towel_cycle_log;
CREATE POLICY "Employees insert towel cycle" ON towel_cycle_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Supervisors read towel cycle" ON towel_cycle_log;
CREATE POLICY "Supervisors read towel cycle" ON towel_cycle_log
  FOR SELECT USING (is_supervisor(auth.uid()));

-- Sin trigger de prevent_hard_delete aquí a propósito: es un log de conteo
-- operativo de alta frecuencia, no evidencia legal/financiera. Si se decide
-- lo contrario más adelante, se agrega igual que las demás tablas.

-- Implementos caros reservables por equipo/día (vaporizador, HEPA, etc.)
CREATE TABLE IF NOT EXISTS equipment_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
  reserved_date DATE NOT NULL,
  assignment_id UUID REFERENCES assignments(id),
  reserved_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_reservation_unique
  ON equipment_reservations(inventory_item_id, reserved_date)
  WHERE deleted_at IS NULL;

ALTER TABLE equipment_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supervisors manage equipment reservations" ON equipment_reservations;
CREATE POLICY "Supervisors manage equipment reservations" ON equipment_reservations
  FOR ALL USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Employees read equipment reservations" ON equipment_reservations;
CREATE POLICY "Employees read equipment reservations" ON equipment_reservations
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS trg_prevent_delete ON equipment_reservations;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON equipment_reservations
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ============================================================
-- 6. Llaves (D.7.5): en persona / lockbox / tercero / problema -> escala
-- ============================================================
CREATE TABLE IF NOT EXISTS key_handling_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL
    CHECK (method IN ('in_person', 'lockbox', 'third_party', 'problem')),
  lockbox_code TEXT, -- solo si method = lockbox; se entrega en el brief 30 min antes
  confirmed_returned BOOLEAN NOT NULL DEFAULT false, -- confirmación al devolver (en persona)
  signature_url TEXT, -- firma digital (tercero)
  closing_photo_url TEXT, -- foto al cerrar (lockbox)
  escalated_at TIMESTAMPTZ, -- si "problema": escala a los 15 min
  escalation_resolved_as TEXT, -- ej: 'resolved', 'no_show'
  recorded_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_key_handling_order ON key_handling_log(order_id);

ALTER TABLE key_handling_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Employees insert key handling" ON key_handling_log;
CREATE POLICY "Employees insert key handling" ON key_handling_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Supervisors read key handling" ON key_handling_log;
CREATE POLICY "Supervisors read key handling" ON key_handling_log
  FOR SELECT USING (is_supervisor(auth.uid()));
DROP POLICY IF EXISTS "Supervisors update key handling" ON key_handling_log;
CREATE POLICY "Supervisors update key handling" ON key_handling_log
  FOR UPDATE USING (is_supervisor(auth.uid())) WITH CHECK (is_supervisor(auth.uid()));

DROP TRIGGER IF EXISTS trg_prevent_delete ON key_handling_log;
CREATE TRIGGER trg_prevent_delete BEFORE DELETE ON key_handling_log
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

COMMENT ON TABLE suppliers IS 'v8.3 E7: estructura vacia a proposito. Cargar proveedores reales desde el admin.';
COMMENT ON TABLE inventory_items IS 'v8.3 E7: estructura vacia a proposito. Cargar productos reales desde el admin.';
