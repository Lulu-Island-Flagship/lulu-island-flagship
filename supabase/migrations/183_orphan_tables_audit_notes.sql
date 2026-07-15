-- v8.3 — Auditoría de código huérfano (2026-07-15): documentación de veredicto
-- para tablas creadas en migraciones antiguas que ninguna ruta TS lee/escribe
-- (`.from("tabla")`). No se dropea nada aquí -- solo se deja constancia en el
-- propio esquema para que cualquier revisión futura (humana o de otra sesión)
-- sepa qué es cada una sin tener que re-investigar desde cero.
--
-- Clasificación completa (ver commit edb0595 y conversación de auditoría):
--   rate_limits            -> FALSO POSITIVO: sí está en uso, pero vía
--                              supabase.rpc("check_rate_limit", ...) en
--                              src/app/api/quote/route.ts, client/review/route.ts
--                              y analytics/event/route.ts -- el audit ingenuo
--                              solo buscaba `.from(...)` y no detectó el RPC.
--   contract_instances      -> DEUDA TÉCNICA, diseño abandonado. El sistema de
--                              contratos recurrentes (service_contracts) nunca
--                              generó filas hijas por visita; next-visit/route.ts
--                              actualiza next_scheduled_date directo en el
--                              contrato. Candidata a DROP en limpieza futura.
--   legal_feed_status       -> DEUDA TÉCNICA, superseded por pipeda_legal_monitoring
--                              (migración 142), conectada en
--                              admin/legal-monitoring/route.ts y el cron
--                              legal-monitoring-healthcheck. Candidata a DROP.
--   property_manager_benefits -> DEUDA TÉCNICA, superseded por
--                              property_manager_building_benefits (migración 163)
--                              + partner_commissions (migración 147), conectadas
--                              en admin/retention-gifts/building-benefits/route.ts.
--                              Candidata a DROP.
--   neighborhood_complaints -> DEUDA TÉCNICA / bug de nombre. Reemplazada por
--                              neighbor_complaints (sin "hood", migración 148),
--                              que sí usa admin/neighborhood/route.ts. Tabla
--                              fantasma nunca escrita por typo entre migraciones.
--                              Candidata a DROP. (neighbor_leads, la otra tabla
--                              de la migración 050, sigue viva y en uso).
--   qbo_exports             -> IMPLEMENTADA en edb0595: cron/qbo-sync/route.ts
--                              ahora crea/actualiza la fila padre (status,
--                              totales) y enlaza qbo_export_lines.export_id.
--   equipment_reservations  -> PENDIENTE, feature real de E7 (spec: reserva de
--                              equipos caros -- vaporizador, HEPA -- por
--                              equipo/día). Falta crear endpoint admin y
--                              conectarlo al dispatch. NO implementado todavía;
--                              requiere decisión de negocio sobre prioridad.
--   supplier_catalog        -> PENDIENTE, feature real de E7 (catálogo
--                              precio×producto con histórico effective_from/
--                              is_current para alimentar costo de POs). Falta
--                              wireado en admin/suppliers/route.ts o endpoint
--                              nuevo. NO implementado todavía.
--
-- No se ejecuta ningún ALTER/DROP en esta migración -- es intencionalmente un
-- no-op de documentación (ver COMMENT ON TABLE abajo, que sí persiste en el
-- catálogo de Postgres y es visible para cualquiera que inspeccione el schema).

COMMENT ON TABLE contract_instances IS
  'v8.3 (2026-07-15): DEUDA TÉCNICA -- diseño abandonado, nunca conectado. service_contracts + next-visit/route.ts reemplazan esta idea sin generar filas hijas. Candidata a DROP.';

COMMENT ON TABLE legal_feed_status IS
  'v8.3 (2026-07-15): DEUDA TÉCNICA -- superseded por pipeda_legal_monitoring (migración 142). Candidata a DROP.';

COMMENT ON TABLE property_manager_benefits IS
  'v8.3 (2026-07-15): DEUDA TÉCNICA -- superseded por property_manager_building_benefits (163) + partner_commissions (147). Candidata a DROP.';

COMMENT ON TABLE neighborhood_complaints IS
  'v8.3 (2026-07-15): DEUDA TÉCNICA -- tabla fantasma, bug de nombre. Reemplazada por neighbor_complaints (148), que sí está en uso. Candidata a DROP.';

COMMENT ON TABLE equipment_reservations IS
  'v8.3 (2026-07-15): PENDIENTE -- feature real de E7 (reserva de equipos caros por equipo/día), aún no conectada a ningún endpoint. No es deuda técnica, es trabajo faltante.';

COMMENT ON TABLE supplier_catalog IS
  'v8.3 (2026-07-15): PENDIENTE -- feature real de E7 (catálogo precio×producto con histórico), aún no conectada a admin/suppliers/route.ts. No es deuda técnica, es trabajo faltante.';
