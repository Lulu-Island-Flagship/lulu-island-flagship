-- Migración 132 — v8.3 E4: zonas editables por el admin propagan a
-- COTIZACIÓN (D.7 "agregar zona = nombre + peso + tiempo estimado, y
-- aparece automáticamente en cotización, reparto y checklist"; criterio de
-- aceptación E4 #4, tercer tercio que faltaba tras la migración 104).
--
-- Contexto: 104 conectó zone_weight a reparto (zone-reparto.ts) y checklist
-- (siempre estuvo ahí). Faltaba cotización. No todas las zonas deben cobrar
-- — Cocina/Baño/Sala/Habitación ya están dentro del precio base D.1/D.2 (la
-- tabla HHE por ft²); cobrarlas de nuevo sería duplicar. Solo zonas NUEVAS
-- que el admin agrega y marca explícitamente como "add-on" (ej. Garaje,
-- Bodega, Patio) deben sumar precio — por eso `is_addon_zone` es una
-- decisión consciente del admin, no automática (protege el piso de margen y
-- la transparencia de precio, invariantes B.2.4/B.2.24), con default FALSE
-- para no alterar retroactivamente ningún precio existente.
--
-- zone_time_hours es el "tiempo estimado" que pide D.7 explícitamente y que
-- no existía en ningún lado — sin esto, is_addon_zone no tendría con qué
-- calcular el recargo.

ALTER TABLE sop_checklists
  ADD COLUMN IF NOT EXISTS zone_time_hours NUMERIC(4,2) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS is_addon_zone BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN sop_checklists.zone_time_hours IS
  'v8.3 E4 (D.7): "tiempo estimado" de la zona, editable por el admin junto '
  'con zone_weight. Cuando is_addon_zone=true, zone_time_hours × tarifa '
  'objetivo/hr es el recargo que se suma en la cotización si el cliente '
  'selecciona esa zona (src/lib/pricing.ts calculateAddonZonesCharge).';

COMMENT ON COLUMN sop_checklists.is_addon_zone IS
  'v8.3 E4 (D.7): true = esta zona NO está cubierta por la tabla HHE base '
  '(D.1) y se ofrece como selección opcional en el cotizador, sumando '
  'zone_time_hours × tarifa al precio y apareciendo en el checklist SOLO en '
  'las órdenes donde el cliente la seleccionó (orders.addon_zones). Default '
  'FALSE a propósito: el admin debe decidirlo explícitamente, nunca es '
  'automático (protege B.2.4 precio transparente y B.2.24 piso de margen). '
  'Las zonas del catálogo D.7 (kitchen/bathroom/living/bedroom/...) quedan '
  'en FALSE porque ya están incluidas en el precio base.';

-- quotes.addon_zones / addon_zones_charge: selección y monto tal como se
-- calcularon en la cotización (igual que el resto de las columnas de
-- desglose de precio de `quotes`).
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS addon_zones TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS addon_zones_charge INTEGER NOT NULL DEFAULT 0;

-- orders.addon_zones: qué zonas opcionales seleccionó el cliente en la
-- cotización. Se congela con la orden (igual que el resto del precio
-- sellado, invariante B.2.11) — cambiarlo después es una línea nueva, no
-- una mutación del original.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS addon_zones TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN orders.addon_zones IS
  'v8.3 E4 (D.7): códigos de zona opcional (sop_checklists.zone con '
  'is_addon_zone=true) seleccionados por el cliente en el cotizador. '
  'Precio sellado al reservar (B.2.11): no se recalcula solo, y el checklist '
  'del líder (D.7) solo muestra estas zonas add-on si están aquí.';
