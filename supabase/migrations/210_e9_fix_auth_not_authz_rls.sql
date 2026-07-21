-- v8.3 fix C-H3 (auditoría RBAC/compliance 2026-07-21)
--
-- HALLAZGO: siete políticas RLS de INSERT confundían "autenticado" con
-- "autorizado" -- `WITH CHECK (auth.uid() IS NOT NULL)` deja pasar a
-- CUALQUIER usuario con sesión, incluido un cliente recién registrado
-- (anon key + su propio JWT), no solo a empleados. Los nombres de las
-- políticas ("Employees insert ...") ya declaraban la intención real; el
-- CHECK nunca la aplicó. Combinado con `trg_prevent_delete` (migración 039),
-- un cliente podía inyectar un registro de custodia de llaves falso e
-- INBORRABLE, o un incidente WorkSafeBC ficticio.
--
-- FIX: reemplaza el CHECK por una verificación real de que quien escribe es
-- un empleado activo (key_handling_log, towel_cycle_log, safety_aborts,
-- near_misses, workplace_incidents) o un supervisor/admin operativo
-- (neighbor_complaints, neighbor_leads -- estas dos las origina el negocio,
-- no un empleado de campo, según su propio flujo de "Supervisors manage").
-- Ambas funciones (is_supervisor/has_admin_role) ya existen desde la
-- migración 040 y no requieren cambios.

-- ------------------------------------------------------------
-- key_handling_log (048)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Employees insert key handling" ON key_handling_log;
CREATE POLICY "Employees insert key handling" ON key_handling_log
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND is_active = true)
    OR is_supervisor(auth.uid())
  );

-- ------------------------------------------------------------
-- towel_cycle_log (048)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Employees insert towel cycle" ON towel_cycle_log;
CREATE POLICY "Employees insert towel cycle" ON towel_cycle_log
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND is_active = true)
    OR is_supervisor(auth.uid())
  );

-- ------------------------------------------------------------
-- safety_aborts (069) -- ya tiene UPDATE/SELECT correctos, solo el INSERT
-- estaba mal.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Employees create own safety aborts" ON safety_aborts;
CREATE POLICY "Employees create own safety aborts" ON safety_aborts
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND is_active = true)
    OR is_supervisor(auth.uid())
  );

-- ------------------------------------------------------------
-- near_misses (047)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Employees insert near misses" ON near_misses;
CREATE POLICY "Employees insert near misses" ON near_misses
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND is_active = true)
    OR is_supervisor(auth.uid())
  );

-- ------------------------------------------------------------
-- workplace_incidents (144)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Employees insert workplace incidents" ON workplace_incidents;
CREATE POLICY "Employees insert workplace incidents" ON workplace_incidents
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND is_active = true)
    OR is_supervisor(auth.uid())
  );

-- ------------------------------------------------------------
-- neighbor_complaints (148) -- el flujo de vecinos lo origina el negocio
-- (recepción de queja por teléfono/en persona), no un cliente ni un
-- empleado de campo cualquiera; se exige supervisor/admin operativo.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Employees insert neighbor complaints" ON neighbor_complaints;
CREATE POLICY "Employees insert neighbor complaints" ON neighbor_complaints
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

-- ------------------------------------------------------------
-- neighbor_leads (148) -- mismo criterio; ya existe "Supervisors manage
-- neighbor leads" FOR ALL con is_supervisor(), así que este INSERT era
-- además redundante con un candado más débil que el de su propia tabla.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Employees insert neighbor leads" ON neighbor_leads;
CREATE POLICY "Employees insert neighbor leads" ON neighbor_leads
  FOR INSERT WITH CHECK (is_supervisor(auth.uid()));

COMMENT ON POLICY "Employees insert key handling" ON key_handling_log IS
  'v8.3 fix C-H3: auth.uid() IS NOT NULL dejaba pasar a cualquier cliente autenticado, no solo empleados.';
COMMENT ON POLICY "Employees insert towel cycle" ON towel_cycle_log IS
  'v8.3 fix C-H3: idem key_handling_log.';
COMMENT ON POLICY "Employees create own safety aborts" ON safety_aborts IS
  'v8.3 fix C-H3: idem key_handling_log.';
COMMENT ON POLICY "Employees insert near misses" ON near_misses IS
  'v8.3 fix C-H3: idem key_handling_log.';
COMMENT ON POLICY "Employees insert workplace incidents" ON workplace_incidents IS
  'v8.3 fix C-H3: idem key_handling_log -- este era el más grave, genera deadline WorkSafeBC.';
COMMENT ON POLICY "Employees insert neighbor complaints" ON neighbor_complaints IS
  'v8.3 fix C-H3: restringido a supervisor/admin operativo, el flujo lo origina el negocio.';
COMMENT ON POLICY "Employees insert neighbor leads" ON neighbor_leads IS
  'v8.3 fix C-H3: idem neighbor_complaints.';
