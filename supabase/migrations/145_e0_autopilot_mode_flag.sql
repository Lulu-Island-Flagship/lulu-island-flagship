-- Migración 145 — v8.3 E0.11: flag global Autopilot/Manual.
--
-- "Manual = el sistema sugiere y espera (timeout 10 min → Fallback a
-- Autopilot). Autopilot = corre solo con reglas pre-aprobadas. Recomendación
-- de uso: Manual meses 1-4, Autopilot después; en crisis siempre Autopilot."
--
-- DISEÑO HONESTO: cada módulo de excepción (dispatch-fallback, safety-abort,
-- chemical-lockout, etc.) ya implementa su propio timer de 10 min con
-- auto-decisión al vencer -- ESO es, en la práctica, el comportamiento de
-- Autopilot, y ya corre siempre así hoy. Este flag no reescribe esa lógica
-- interna (blast radius demasiado grande para tocar en un solo pase); lo que
-- hace es dar el interruptor operativo GLOBAL, visible y auditable, que el
-- spec pide -- reutilizando la infraestructura genérica de feature_flags que
-- ya tiene snapshot/undo/audit-log gratis (admin_update_config RPC,
-- migración 042). El admin dashboard lo muestra de forma prominente
-- (src/lib/autopilot-mode.ts) para que el "sugiere y espera" de Manual sea
-- una señal visible, no solo un valor de base de datos sin efecto.
--
-- Default: false (Manual) -- coincide con la recomendación de uso de los
-- primeros meses.

INSERT INTO feature_flags (nombre, activo, modulo, descripcion)
VALUES (
  'e0_autopilot_mode',
  false,
  'E0 Fundación',
  'true = Autopilot (el sistema decide solo con reglas pre-aprobadas). false = Manual (el sistema sugiere y espera aprobación; igual auto-decide a los 10 min por Fallback, pero el dashboard lo marca como pendiente de revisión humana). Recomendación: Manual meses 1-4, Autopilot después; en crisis siempre Autopilot.'
)
ON CONFLICT (nombre) DO NOTHING;
