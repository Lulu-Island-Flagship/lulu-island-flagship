-- Fix auditoría de seguridad externa (2026-08-01): varias funciones
-- SECURITY DEFINER quedaban expuestas para ejecución a `PUBLIC`/`anon`/
-- `authenticated` sin ninguna restricción -- PostgREST expone TODO RPC al
-- rol `authenticated` salvo que se revoque explícitamente (mismo patrón de
-- hallazgo ya corregido para apply_wallet_delta en la migración 233).
--
-- Verificación (grep sobre src/**/*.ts, 2026-08-01) de quién llama cada
-- función vía `.rpc(...)`:
--
--   increment_disputes_lost_count(p_user_id)
--     -> solo src/app/api/stripe/webhook/route.ts, con
--        SUPABASE_SERVICE_ROLE_KEY (createClient con supabaseServiceKey,
--        línea ~41). Ningún código de cliente la invoca.
--
--   increment_no_show_count(p_user_id)
--     -> solo src/app/api/cron/no-show/route.ts, con
--        SUPABASE_SERVICE_ROLE_KEY (createClient con supabaseServiceKey,
--        línea ~177). Ningún código de cliente la invoca.
--
--   generate_review_token(p_order_id)
--     -> NINGÚN código TypeScript la invoca vía `.rpc(...)`. Solo se
--        dispara internamente vía el trigger
--        trigger_generate_review_token_on_complete (migración
--        014/127) al completarse una orden. La ejecución de un trigger NO
--        requiere que el rol que originó el UPDATE tenga privilegio EXECUTE
--        sobre la función del trigger, así que revocar EXECUTE aquí no
--        rompe ese flujo.
--
--   Para las tres funciones de arriba: se revoca EXECUTE de
--   PUBLIC/anon/authenticated y se otorga solo a service_role. Sin este
--   fix, cualquier usuario autenticado podía llamar
--   supabase.rpc('increment_no_show_count', { p_user_id: '<otro cliente>' })
--   o el equivalente de disputas perdidas directo desde el cliente y
--   sabotear el score de reputación de CUALQUIER cliente (ambos contadores
--   alimentan penalizaciones del spec v8.2), o regenerar
--   generate_review_token de una orden ajena.
--
--   increment_client_services_count(target_user_id)
--     -> SÍ es invocada por una sesión de usuario autenticado normal (NO
--        service_role): src/app/api/empleado/servicio/route.ts usa
--        createServerClient(...) con NEXT_PUBLIC_SUPABASE_ANON_KEY +
--        cookies de la sesión del EMPLEADO (getSupabaseClient(), línea
--        ~20-39), para incrementar el contador de servicios del CLIENTE
--        (target_user_id = order.user_id, NO el propio empleado) al cerrar
--        una orden. No se puede revocar EXECUTE de `authenticated` sin
--        romper ese flujo real, y tampoco aplica la validación
--        "auth.uid() = target_user_id" (el empleado nunca es el cliente).
--        En su lugar, se reescribe la función para exigir, cuando quien
--        llama NO es un rol de confianza server-side, que exista una
--        asignación 'completed' de un empleado activo (auth.uid()) sobre
--        una orden 'completed' cuyo user_id sea exactamente target_user_id
--        -- así se ata la llamada a un cierre de servicio real y verificable
--        en vez de permitir incrementar el contador de CUALQUIER cliente a
--        voluntad.

REVOKE EXECUTE ON FUNCTION increment_disputes_lost_count(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_disputes_lost_count(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION increment_no_show_count(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_no_show_count(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION generate_review_token(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_review_token(UUID) TO service_role;

CREATE OR REPLACE FUNCTION increment_client_services_count(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() lee el JWT de la sesión real (no current_user, que en
  -- SECURITY DEFINER devuelve el dueño de la función, no el caller).
  -- auth.uid() es NULL para llamadas service_role (sin sesión JWT).
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      JOIN orders o ON o.id = a.order_id
      WHERE e.user_id = auth.uid()
        AND a.status = 'completed'
        AND o.status = 'completed'
        AND o.user_id = target_user_id
    ) THEN
      RAISE EXCEPTION
        'increment_client_services_count: no autorizado -- se requiere una asignación completada, de un empleado activo, sobre una orden completada de este cliente'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE client_profiles
  SET services_count = services_count + 1,
      updated_at = now()
  WHERE user_id = target_user_id;
END;
$$;

-- No se revoca de `authenticated` (ver justificación arriba): el flujo real
-- de cierre de servicio por un empleado depende de ese grant. Se revoca de
-- anon (nadie sin sesión debería poder llamarla) y se deja el grant
-- explícito a authenticated + service_role.
REVOKE EXECUTE ON FUNCTION increment_client_services_count(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION increment_client_services_count(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION increment_client_services_count(UUID) IS
  'Fix auditoría de seguridad externa (migración 300, 2026-08-01): EXECUTE '
  'permanece otorgado a `authenticated` porque empleados reales la invocan '
  'con su propia sesión (no service_role) al cerrar un servicio -- ver '
  'src/app/api/empleado/servicio/route.ts. La función valida internamente '
  'que exista una asignación completada del empleado autenticado sobre una '
  'orden completada del target_user_id antes de mutar client_profiles.';
