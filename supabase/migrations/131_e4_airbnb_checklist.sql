-- Migración 131 — v8.3 E4: checklist Airbnb/turnaround distinto del
-- residencial (D.7 "Protocolo Airbnb/turnaround (NO es B2B...)", criterio de
-- aceptación E4 #7)
--
-- Contexto (auditoría 13 julio 2026): "airbnb" ya existe como service_subtype
-- real y seleccionable en el cotizador (src/lib/pricing.ts,
-- SERVICE_SUBTYPES.commercial), y orders.service_subtype se persiste con ese
-- valor. Pero sop_checklists NUNCA tuvo filas para service_subtype='airbnb'
-- — GET /api/empleado/checklist?serviceSubtype=airbnb devolvía cero zonas
-- (o, si alguien lo creaba a mano en el admin, un checklist genérico). El
-- protocolo distinto de D.7 (inspección de entrada, lavandería primero,
-- agregados por zona, staging contra foto de referencia, inspección final
-- "con ojos de huésped") no tenía ninguna fila. Esta migración lo agrega
-- como checklist propio, estructuralmente distinto del residencial (zonas
-- distintas: entry_inspection, laundry, staging, final_inspection no existen
-- en 'first_time'/'regular'/'move_in_out').
--
-- Nota de alcance: esto cubre el CHECKLIST (criterio E4 #7). El cobro por
-- evento/propiedad (D.7: "tarifa fija por evento, no tabla ft²") y el
-- spec de reabastecimiento estructurado por propiedad (hoy referenciado
-- como texto libre "ver notas de propiedad" en los ítems de abajo) quedan
-- pendientes como huecos de E1/E9, fuera del alcance de este criterio.

INSERT INTO sop_checklists (service_subtype, zone, zone_label, zone_color, zone_icon, items, sort_order, zone_weight)
VALUES
  ('airbnb', 'entry_inspection', 'Entry Inspection', 'green', '🔑', '[
    {"id":"e1","label":"Entry photo + timestamp (general condition)","required":true},
    {"id":"e2","label":"Check for guest items left behind — report to host, never discard","required":true},
    {"id":"e3","label":"Document any damage with photo before touching anything","required":true}
  ]', 1, 1.0),
  ('airbnb', 'laundry', 'Laundry (start first)', 'green', '🧺', '[
    {"id":"la1","label":"Start first laundry load immediately (sheets/towels)","required":true},
    {"id":"la2","label":"Sort soiled linens by color/type","required":false}
  ]', 2, 1.0),
  ('airbnb', 'bedroom', 'Bedroom (Airbnb add-ons)', 'green', '✨', '[
    {"id":"r1","label":"Under the bed cleared and cleaned","required":true},
    {"id":"r2","label":"Inside closets and drawers checked","required":true},
    {"id":"r3","label":"Ceiling fan / light fixture dust-free","required":false},
    {"id":"r4","label":"Light switches, handles, and remote disinfected","required":true},
    {"id":"r5","label":"Remote control batteries working","required":false},
    {"id":"r6","label":"Trash bin with fresh liner","required":true},
    {"id":"r7","label":"Fresh linens set (correct sheet/pillowcase set)","required":true}
  ]', 3, 1.5),
  ('airbnb', 'bathroom', 'Bathroom (Airbnb add-ons)', 'red', '🚽', '[
    {"id":"b1","label":"Minimum 2 rolls of toilet paper visible","required":true},
    {"id":"b2","label":"Amenities restocked per host spec (see property notes)","required":true},
    {"id":"b3","label":"Toilet, sink, shower disinfected","required":true},
    {"id":"b4","label":"Floor clean and dry","required":true}
  ]', 4, 3.0),
  ('airbnb', 'kitchen', 'Kitchen (Airbnb add-ons)', 'blue', '🍳', '[
    {"id":"k1","label":"Previous guest leftovers removed from fridge","required":true},
    {"id":"k2","label":"Dishware and coffee maker reset to host standard position","required":true},
    {"id":"k3","label":"Supplies restocked per host spec (see property notes)","required":true},
    {"id":"k4","label":"Counters and sink disinfected","required":true}
  ]', 5, 3.0),
  ('airbnb', 'staging', 'Staging vs. Listing Photo', 'green', '📷', '[
    {"id":"s1","label":"Staging compared against the listing reference photo (see property profile)","required":true},
    {"id":"s2","label":"Decorative items in their original position","required":true}
  ]', 6, 1.5),
  ('airbnb', 'final_inspection', 'Final Inspection', 'green', '👀', '[
    {"id":"fi1","label":"Final walkthrough with guest eyes before closing photo","required":true}
  ]', 7, 1.0)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sop_checklists IS
  'v8.3 E4 (D.7): plantillas de checklist por service_subtype. El subtipo '
  '''airbnb'' es estructuralmente distinto del residencial simple '
  '(first_time/regular/move_in_out): zonas propias entry_inspection, '
  'laundry, staging y final_inspection que no existen en los otros subtipos '
  '— son dos checklists reales, no el mismo con una bandera.';
