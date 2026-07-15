-- v8.3 — Gap encontrado en auditoría de flujo cliente (2026-07-15): solo
-- existía detección de no-show del CLIENTE (falta t_in, se asume que el
-- cliente no estaba en casa). No había ninguna forma de distinguir el caso
-- contrario -- el EQUIPO nunca llegó (falta t_in por causa del empleado,
-- p.ej. nunca inició turno) -- así que ese escenario terminaba
-- silenciosamente cobrando la penalidad de no-show a un cliente que en
-- realidad estuvo esperando a un equipo que nunca iba a aparecer.
--
-- `cause` distingue ambos casos; se calcula una sola vez al detectar el
-- no-show, revisando si el empleado asignado registró jornada_start hoy.
ALTER TABLE no_show_logs
  ADD COLUMN IF NOT EXISTS cause TEXT NOT NULL DEFAULT 'client'
    CHECK (cause IN ('client', 'employee', 'unknown'));

COMMENT ON COLUMN no_show_logs.cause IS
  'v8.3: client = el cliente no estaba (empleado sí inició turno); employee = el equipo asignado nunca inició turno hoy -- NO se penaliza al cliente, se alerta a admin para reasignación urgente.';
