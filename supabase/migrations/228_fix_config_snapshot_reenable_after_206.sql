-- Contraparte de 197_fix_config_snapshot_bypass_for_206.sql: reactiva el
-- trigger de auditoría de configuración sobre communication_templates una
-- vez que 206_e0_retire_spanish_locale_and_rls.sql ya terminó sus 19 UPDATE
-- en crudo. A partir de aquí, cualquier escritura real de la aplicación
-- (siempre vía el RPC admin_update_config, nunca UPDATE directo) vuelve a
-- quedar auditada normalmente en config_snapshots, igual que antes de este
-- fix.
ALTER TABLE communication_templates ENABLE TRIGGER trg_config_snapshot;
