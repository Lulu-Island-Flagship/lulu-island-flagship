-- v8.3 (2026-07-15) — Limpieza tras auditoría de código huérfano (ver 183 y
-- commit edb0595/5d0fd4d). Estas 4 tablas fueron marcadas como DEUDA TÉCNICA
-- superseded por migraciones posteriores hace ya un ciclo de auditoría; se
-- confirmó de nuevo (grep en src/ completo) que ningún código TS las
-- referencia antes de ejecutar el DROP. No confundir con equipment_reservations
-- y supplier_catalog (migración 048), que SÍ se conectaron a código real.
--
--   contract_instances        -> reemplazada por el flujo actual de
--                                 service_contracts + next-visit/route.ts.
--   legal_feed_status         -> reemplazada por pipeda_legal_monitoring (142).
--   property_manager_benefits -> reemplazada por property_manager_building_benefits
--                                 (163) + partner_commissions (147).
--   neighborhood_complaints   -> bug de nombre, reemplazada por
--                                 neighbor_complaints (148).

DROP TABLE IF EXISTS contract_instances CASCADE;
DROP TABLE IF EXISTS legal_feed_status CASCADE;
DROP TABLE IF EXISTS property_manager_benefits CASCADE;
DROP TABLE IF EXISTS neighborhood_complaints CASCADE;
