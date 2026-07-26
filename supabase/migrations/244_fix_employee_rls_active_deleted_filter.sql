-- 244_fix_employee_rls_active_deleted_filter.sql
--
-- Auditoría de seguridad crítica (2026-07-26): decenas de políticas RLS que
-- validan pertenencia vía `employee_id IN (SELECT id FROM employees WHERE
-- user_id = auth.uid())` (o variantes EXISTS/otras columnas) NO verifican
-- `employees.is_active = true` ni `employees.deleted_at IS NULL`. Esto
-- significa que un empleado desactivado o dado de baja (soft-delete) puede
-- seguir leyendo/insertando/actualizando sus propias filas en todas las
-- tablas protegidas por estas políticas, aunque la capa de API lo bloquee --
-- la defensa en profundidad a nivel de base de datos estaba rota.
--
-- La función `is_supervisor()` (migración 003/004) SÍ filtra
-- `role = 'supervisor' AND is_active = true` (no filtra deleted_at -- ver
-- nota de limpieza futura al final de este archivo), pero la mayoría de las
-- políticas de "propio empleado" usan la subconsulta directa sin ese filtro.
--
-- Fix: agregar `AND is_active = true AND deleted_at IS NULL` dentro de cada
-- subconsulta a `employees`, preservando el resto de la lógica original de
-- cada política (mismo FOR SELECT/INSERT/UPDATE/DELETE, mismas condiciones
-- adicionales ya existentes como `resolution = 'pending'`,
-- `pay_type <> 'paid'`, `appealed_at IS NULL`, etc.). Idempotente: usa
-- DROP POLICY IF EXISTS antes de cada CREATE.
--
-- Columnas confirmadas en `employees`: `user_id`, `is_active BOOLEAN NOT
-- NULL DEFAULT true` (003_modulo3_employee_tables.sql), `deleted_at
-- TIMESTAMPTZ` (039_e0_soft_delete_universal.sql).
--
-- NOTA IMPORTANTE: esta migración NO se aplica automáticamente aquí -- solo
-- se crea el archivo para revisión posterior.

-- ============================================================
-- 0. Tabla employees -- perfil propio del empleado
--    (003_modulo3_employee_tables.sql)
--    Restringimos SOLO la política que usa auth.uid() = user_id (el propio
--    empleado). NO tocamos "Supervisors read all employees" (usa
--    is_supervisor(), necesaria para que un admin/supervisor pueda ver y
--    reactivar a un empleado desactivado).
-- ============================================================

DROP POLICY IF EXISTS "Employees read own profile" ON employees;
CREATE POLICY "Employees read own profile" ON employees
  FOR SELECT USING (
    auth.uid() = user_id AND is_active = true AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS "Employees update own profile" ON employees;
CREATE POLICY "Employees update own profile" ON employees
  FOR UPDATE USING (
    auth.uid() = user_id AND is_active = true AND deleted_at IS NULL
  );

-- ============================================================
-- 1. assignments (003_modulo3_employee_tables.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own assignments" ON assignments;
CREATE POLICY "Employees read own assignments" ON assignments
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees update own assignments" ON assignments;
CREATE POLICY "Employees update own assignments" ON assignments
  FOR UPDATE USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 2. service_logs (003_modulo3_employee_tables.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own logs" ON service_logs;
CREATE POLICY "Employees read own logs" ON service_logs
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees insert own logs" ON service_logs;
CREATE POLICY "Employees insert own logs" ON service_logs
  FOR INSERT WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 3. service_checklist_items (006_modulo4_checklist_tables.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own checklist items" ON service_checklist_items;
CREATE POLICY "Employees read own checklist items" ON service_checklist_items
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees insert own checklist items" ON service_checklist_items;
CREATE POLICY "Employees insert own checklist items" ON service_checklist_items
  FOR INSERT WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees update own checklist items" ON service_checklist_items;
CREATE POLICY "Employees update own checklist items" ON service_checklist_items
  FOR UPDATE USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 4. service_upsells (006_modulo4_checklist_tables.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own upsells" ON service_upsells;
CREATE POLICY "Employees read own upsells" ON service_upsells
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees insert own upsells" ON service_upsells;
CREATE POLICY "Employees insert own upsells" ON service_upsells
  FOR INSERT WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 5. employee_scores (010_modulo7_qc_score_tables.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own scores" ON employee_scores;
CREATE POLICY "Employees read own scores" ON employee_scores
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 6. field_audits (010_modulo7_qc_score_tables.sql)
--    NOTA DE INCONSISTENCIA (documentada, no corregida aquí más allá del
--    filtro de estado): existían DOS políticas UPDATE de empleado
--    simultáneamente vigentes y activas sobre esta tabla --
--    "Employees appeal own audits" (creada en 217, sin filtro de
--    appealed_at) y "Employees appeal own unresolved audits" (creada en
--    236, con filtro appealed_at IS NULL + WITH CHECK), ninguna dropeaba a
--    la otra. Como políticas permisivas del mismo comando se combinan con
--    OR, la más laxa ("Employees appeal own audits") anulaba en la práctica
--    la restricción de la más nueva. Aquí se eliminan AMBAS y se deja una
--    sola política consolidada (con la lógica de appealed_at IS NULL de la
--    236, que es la más reciente y más restrictiva) con el filtro de
--    estado agregado. Esto debería revisarse/documentarse aparte como
--    limpieza de políticas duplicadas.
-- ============================================================

DROP POLICY IF EXISTS "Employees read own audits" ON field_audits;
CREATE POLICY "Employees read own audits" ON field_audits
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees appeal own audits" ON field_audits;
DROP POLICY IF EXISTS "Employees appeal own unresolved audits" ON field_audits;
CREATE POLICY "Employees appeal own unresolved audits" ON field_audits
  FOR UPDATE
  USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
    AND appealed_at IS NULL
  )
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 7. peer_votes (010_modulo7_qc_score_tables.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own votes" ON peer_votes;
CREATE POLICY "Employees read own votes" ON peer_votes
  FOR SELECT USING (
    voter_employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees insert own votes" ON peer_votes;
CREATE POLICY "Employees insert own votes" ON peer_votes
  FOR INSERT WITH CHECK (
    voter_employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 8. tickets_disputas (010_modulo7_qc_score_tables.sql / 217)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own tickets" ON tickets_disputas;
CREATE POLICY "Employees read own tickets" ON tickets_disputas
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees insert own tickets" ON tickets_disputas;
CREATE POLICY "Employees insert own tickets" ON tickets_disputas
  FOR INSERT WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 9. payroll_entries (021_modulo2_payroll.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own payroll" ON payroll_entries;
CREATE POLICY "Employees read own payroll" ON payroll_entries
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 10. vehicle_tracking (026_modulo3_capacity_dispatch.sql)
--     Variante: la subconsulta selecciona vehicle_id, no id.
-- ============================================================

DROP POLICY IF EXISTS "Drivers insert own vehicle tracking" ON vehicle_tracking;
CREATE POLICY "Drivers insert own vehicle tracking" ON vehicle_tracking
  FOR INSERT WITH CHECK (
    vehicle_id IN (
      SELECT vehicle_id FROM employees
      WHERE user_id = auth.uid() AND vehicle_id IS NOT NULL
        AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 11. daily_checkins (049_e8_employee_wellbeing.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees manage own checkin" ON daily_checkins;
CREATE POLICY "Employees manage own checkin" ON daily_checkins
  FOR ALL USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  ) WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 12. readiness_requests -- estado vigente definido en
--     213_d_fix_self_service_payroll_rls.sql (reemplazó a 049). Se
--     preserva intacta la condición `resolution = 'pending'` del INSERT
--     (anti-fraude de pago) y solo se agrega el filtro de estado.
-- ============================================================

DROP POLICY IF EXISTS "Employees insert own readiness requests" ON readiness_requests;
CREATE POLICY "Employees insert own readiness requests" ON readiness_requests
  FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
    AND resolution = 'pending'
  );

DROP POLICY IF EXISTS "Employees select own readiness requests" ON readiness_requests;
CREATE POLICY "Employees select own readiness requests" ON readiness_requests
  FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 13. wellbeing_chemical_alerts (049_e8_employee_wellbeing.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees insert own chemical alert" ON wellbeing_chemical_alerts;
CREATE POLICY "Employees insert own chemical alert" ON wellbeing_chemical_alerts
  FOR INSERT WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 14. payroll_ytd (052_e9_payroll_deductions_ytd.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own payroll ytd" ON payroll_ytd;
CREATE POLICY "Employees read own payroll ytd" ON payroll_ytd
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 15. payroll_cycle_deductions (052_e9_payroll_deductions_ytd.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own cycle deductions" ON payroll_cycle_deductions;
CREATE POLICY "Employees read own cycle deductions" ON payroll_cycle_deductions
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 16. service_closures (065_e4_closure_protocol.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own closure" ON service_closures;
CREATE POLICY "Employees read own closure" ON service_closures
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees insert own closure" ON service_closures;
CREATE POLICY "Employees insert own closure" ON service_closures
  FOR INSERT WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees update own closure" ON service_closures;
CREATE POLICY "Employees update own closure" ON service_closures
  FOR UPDATE USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 17. safety_aborts (069_e7_safety_abort_sos.sql)
--     Se preserva el "OR is_supervisor(auth.uid())" existente; solo se
--     agrega el filtro de estado dentro de la subconsulta `reported_by IN`.
--     (El INSERT de esta tabla ya fue corregido en 210 con
--     `AND is_active = true` -- no se toca aquí; ver nota de limpieza
--     futura al final sobre agregarle también `deleted_at IS NULL`.)
-- ============================================================

DROP POLICY IF EXISTS "Employees update own safety aborts" ON safety_aborts;
CREATE POLICY "Employees update own safety aborts" ON safety_aborts
  FOR UPDATE USING (
    reported_by IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
    OR is_supervisor(auth.uid())
  );

DROP POLICY IF EXISTS "Supervisors read safety aborts" ON safety_aborts;
CREATE POLICY "Supervisors read safety aborts" ON safety_aborts
  FOR SELECT USING (
    is_supervisor(auth.uid())
    OR reported_by IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 18. payroll_readiness_credits (090_e9_readiness_payroll_credit.sql)
--     El INSERT de empleado ya fue eliminado por completo en 213 (no se
--     recrea aquí). Solo el SELECT sigue vigente.
-- ============================================================

DROP POLICY IF EXISTS "Employees read own readiness credit" ON payroll_readiness_credits;
CREATE POLICY "Employees read own readiness credit" ON payroll_readiness_credits
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 19. employee_badges (136_e8_badges_career_path.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own badges" ON employee_badges;
CREATE POLICY "Employees read own badges" ON employee_badges
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 20. employee_badge_bonuses (136_e8_badges_career_path.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own badge bonuses" ON employee_badge_bonuses;
CREATE POLICY "Employees read own badge bonuses" ON employee_badge_bonuses
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 21. employee_referral_bonuses (159_e5_referrals_lulu_ambassador.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own referral bonuses" ON employee_referral_bonuses;
CREATE POLICY "Employees read own referral bonuses" ON employee_referral_bonuses
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 22. employee_marketing_features (162_e10_employee_marketing_consent.sql)
--     Nombres de política sin comillas en el original (identificadores en
--     minúsculas, sin espacios) -- se preserva el mismo formato.
-- ============================================================

DROP POLICY IF EXISTS employee_marketing_self_select ON employee_marketing_features;
CREATE POLICY employee_marketing_self_select ON employee_marketing_features
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS employee_marketing_self_consent_update ON employee_marketing_features;
CREATE POLICY employee_marketing_self_consent_update ON employee_marketing_features
  FOR UPDATE USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  ) WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 23. employee_certifications (166_e9_certifications_cra_remittances.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own certifications" ON employee_certifications;
CREATE POLICY "Employees read own certifications" ON employee_certifications
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 24. employee_rest_periods (169_e3_rest_documentation.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own rest periods" ON employee_rest_periods;
CREATE POLICY "Employees read own rest periods" ON employee_rest_periods
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 25. sick_leave_requests -- estado vigente definido en
--     213_d_fix_self_service_payroll_rls.sql (reemplazó a 170). Se
--     preserva intacta la condición anti-fraude de pago
--     (`pay_type <> 'paid' AND paid_amount_cents IS NULL`).
-- ============================================================

DROP POLICY IF EXISTS "Employees insert own sick leave requests" ON sick_leave_requests;
CREATE POLICY "Employees insert own sick leave requests" ON sick_leave_requests
  FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
    AND pay_type <> 'paid'
    AND paid_amount_cents IS NULL
  );

DROP POLICY IF EXISTS "Employees select own sick leave requests" ON sick_leave_requests;
CREATE POLICY "Employees select own sick leave requests" ON sick_leave_requests
  FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 26. storage.objects -- bucket 'sick-notes' (170_e3_sick_leave.sql)
--     Cuidado: el nombre de política es global al esquema storage, pero
--     la condición `bucket_id = 'sick-notes'` ya acota el efecto a este
--     bucket -- no afecta políticas de otros buckets.
-- ============================================================

DROP POLICY IF EXISTS "Employees upload own sick notes" ON storage.objects;
CREATE POLICY "Employees upload own sick notes" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'sick-notes'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees read own sick notes" ON storage.objects;
CREATE POLICY "Employees read own sick notes" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'sick-notes'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 27. statutory_holiday_pay (173_e3_statutory_holiday_pay.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own statutory holiday pay" ON statutory_holiday_pay;
CREATE POLICY "Employees read own statutory holiday pay" ON statutory_holiday_pay
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 28. employee_final_payouts (177_e3_offboarding.sql)
--     NOTA: esta tabla existe específicamente para el flujo de offboarding
--     (empleados YA dados de baja). Se agrega el filtro por consistencia
--     con el resto de la auditoría, pero si en el futuro se detecta que un
--     empleado necesita ver su pago final DESPUÉS de que deleted_at ya
--     esté seteado, esta política tendría que revisarse -- por ahora se
--     mantiene alineada al resto (el pago final se consulta antes de que
--     se complete el soft-delete, o vía canal de admin).
-- ============================================================

DROP POLICY IF EXISTS "Employees read own final payouts" ON employee_final_payouts;
CREATE POLICY "Employees read own final payouts" ON employee_final_payouts
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 29. qc_reviews (190_e5_qc_rework_state.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own qc reviews" ON qc_reviews;
CREATE POLICY "Employees read own qc reviews" ON qc_reviews
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees resubmit own rework" ON qc_reviews;
CREATE POLICY "Employees resubmit own rework" ON qc_reviews
  FOR UPDATE
  USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
    AND status = 'rework'
  )
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 30. team_chat_messages (216_e8_team_chat.sql)
--     Ya filtraba `assignments.deleted_at IS NULL`, pero no el estado del
--     empleado -- un empleado desactivado con una asignación histórica no
--     soft-deleted seguía pudiendo leer/escribir en el chat del equipo.
-- ============================================================

DROP POLICY IF EXISTS "Assigned employees read team chat" ON team_chat_messages;
CREATE POLICY "Assigned employees read team chat" ON team_chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.order_id = team_chat_messages.order_id
        AND e.user_id = auth.uid()
        AND e.is_active = true
        AND e.deleted_at IS NULL
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Assigned employees insert team chat" ON team_chat_messages;
CREATE POLICY "Assigned employees insert team chat" ON team_chat_messages
  FOR INSERT WITH CHECK (
    sender_employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.order_id = team_chat_messages.order_id
        AND e.user_id = auth.uid()
        AND e.is_active = true
        AND e.deleted_at IS NULL
        AND a.deleted_at IS NULL
    )
  );

-- ============================================================
-- 31. chemical_zone_confirmations (219_e4_chemical_lockout_geofence_hardening.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own chemical confirmations" ON chemical_zone_confirmations;
CREATE POLICY "Employees read own chemical confirmations" ON chemical_zone_confirmations
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees insert own chemical confirmations" ON chemical_zone_confirmations;
CREATE POLICY "Employees insert own chemical confirmations" ON chemical_zone_confirmations
  FOR INSERT WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 32. employee_wellbeing_bonuses (226_e8_wellbeing_optout_bonuses_shortcuts.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees read own wellbeing bonuses" ON employee_wellbeing_bonuses;
CREATE POLICY "Employees read own wellbeing bonuses" ON employee_wellbeing_bonuses
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 33. route_shortcuts (226_e8_wellbeing_optout_bonuses_shortcuts.sql)
-- ============================================================

DROP POLICY IF EXISTS "Employees manage own route shortcuts" ON route_shortcuts;
CREATE POLICY "Employees manage own route shortcuts" ON route_shortcuts
  FOR ALL USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  ) WITH CHECK (
    employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- 34. inventory_items / equipment_reservations
--     (240_fix_kimi_m9_inventory_rls_scope.sql)
--     Ese fix (2026-07-21) corrigió que CUALQUIER sesión autenticada podía
--     leer estos datos, pero introdujo el mismo hueco de esta auditoría:
--     EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid()) sin
--     filtro de estado. Se preserva el "is_supervisor(auth.uid()) OR".
-- ============================================================

DROP POLICY IF EXISTS "Employees read inventory items" ON inventory_items;
CREATE POLICY "Employees read inventory items" ON inventory_items
  FOR SELECT USING (
    is_supervisor(auth.uid())
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Employees read equipment reservations" ON equipment_reservations;
CREATE POLICY "Employees read equipment reservations" ON equipment_reservations
  FOR SELECT USING (
    is_supervisor(auth.uid())
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE user_id = auth.uid() AND is_active = true AND deleted_at IS NULL
    )
  );

-- ============================================================
-- NOTAS PARA LIMPIEZA FUTURA (NO se corrigen en esta migración; requieren
-- decisión de producto o una migración separada más amplia):
--
-- 1. `is_supervisor(user_uuid)` (definida en 003, redefinida en 004 sin
--    recursión) filtra `role = 'supervisor' AND is_active = true` pero NO
--    filtra `deleted_at IS NULL`. Esto afecta a DECENAS de políticas en
--    todo el repo que confían en `is_supervisor()` (no solo las de esta
--    migración) -- un supervisor con soft-delete pero is_active aún true
--    (estado inconsistente, pero posible si el soft-delete no siempre
--    setea is_active=false a la vez) retendría acceso de supervisor.
--    Recomendado: auditar el flujo de soft-delete de empleados para
--    confirmar si is_active y deleted_at siempre se actualizan juntos, y
--    si no, agregar `deleted_at IS NULL` a is_supervisor() en una
--    migración dedicada (afecta a muchas más políticas que las 35 de este
--    archivo, requiere su propio análisis de impacto).
--
-- 2. Políticas ya "parcialmente corregidas" antes de esta auditoría
--    (210_e9_fix_auth_not_authz_rls.sql: INSERT de safety_aborts,
--    key_handling_log, towel_cycle_log, near_misses, workplace_incidents)
--    usan `AND is_active = true` pero NUNCA `deleted_at IS NULL`. No se
--    tocan en esta migración porque no usaban el patrón exacto auditado
--    aquí (ya tenían el filtro de is_active), pero comparten el mismo
--    defecto residual de deleted_at y deberían incluirse en una limpieza
--    posterior.
--
-- 3. `employee_final_payouts` (177_e3_offboarding.sql): esta tabla es
--    parte del flujo de offboarding. Si el negocio requiere que un
--    empleado YA marcado deleted_at pueda seguir consultando su pago
--    final por un periodo de gracia, la política de este archivo
--    necesitará ajustarse (por ejemplo, permitir lectura hasta N días
--    después de deleted_at) -- por ahora queda alineada al resto de la
--    auditoría (bloqueada tras baja).
--
-- 4. `field_audits`: se consolidaron dos políticas UPDATE duplicadas
--    (ver comentario en la sección 6) en una sola. Verificar en
--    producción que no exista código dependiendo del nombre de política
--    "Employees appeal own audits" específicamente (no debería, los
--    nombres de política no son referenciados desde la aplicación, solo
--    desde pg_policies/introspección).
-- ============================================================
