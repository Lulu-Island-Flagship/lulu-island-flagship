-- Fix (auditoría externa 2026-07-31, hallazgo confirmado): admin/accounting
-- (src/app/api/admin/accounting/route.ts) deriva `fixedCostsConfigured`
-- como `monthlyFixedCostsCents > 0`. Un negocio cuyo costo fijo mensual
-- REAL y legítimamente configurado es $0 (ej. opera 100% remoto, sin
-- renta/seguro fijo) vería SIEMPRE "aún no configurado" en el dashboard,
-- sin forma de silenciar la advertencia -- el valor 0 es indistinguible del
-- seed inicial sin configurar.
--
-- La migración 134 ya había anticipado este problema en su comentario
-- ("el dashboard debe mostrar explícitamente 'not set' cuando
-- monthly_fixed_costs_cents = 0 Y no hay ninguna fila con reason distinto
-- del seed") pero el código real nunca implementó esa segunda condición --
-- solo miraba el monto. Se agrega una columna explícita en vez de inferir
-- del reason (comparar strings de un campo de texto libre editable es
-- frágil) o del monto (ambiguo con $0 legítimo).

ALTER TABLE fixed_costs_settings
  ADD COLUMN IF NOT EXISTS has_been_configured BOOLEAN NOT NULL DEFAULT true;

-- La fila semilla (134) es la única que representa "todavía sin configurar
-- por el dueño" -- se identifica por su reason literal, que es estable
-- porque nunca se edita in-place (historial inmutable, trigger
-- trg_prevent_delete). Cualquier fila insertada después (vía
-- set_current_fixed_costs) es una configuración real del dueño y
-- has_been_configured ya nace en true por el DEFAULT de la columna.
UPDATE fixed_costs_settings
SET has_been_configured = false
WHERE reason = 'Seed inicial v8.3 E9 — pendiente de configurar por el dueño'
  AND monthly_fixed_costs_cents = 0;

-- Se reemplaza get_current_monthly_fixed_costs_cents() (134) -- que solo
-- devolvía el monto -- por una versión que también devuelve
-- has_been_configured, para que el caller (admin/accounting/route.ts) deje
-- de inferirlo del monto. DROP requerido: Postgres no permite cambiar el
-- tipo de retorno de una función existente con CREATE OR REPLACE.
DROP FUNCTION IF EXISTS get_current_monthly_fixed_costs_cents();

CREATE OR REPLACE FUNCTION get_current_monthly_fixed_costs_cents()
RETURNS TABLE (monthly_fixed_costs_cents INTEGER, has_been_configured BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(
      (SELECT fcs.monthly_fixed_costs_cents
       FROM fixed_costs_settings fcs
       WHERE fcs.effective_to IS NULL
       ORDER BY fcs.effective_from DESC
       LIMIT 1),
      0
    ) AS monthly_fixed_costs_cents,
    COALESCE(
      (SELECT fcs.has_been_configured
       FROM fixed_costs_settings fcs
       WHERE fcs.effective_to IS NULL
       ORDER BY fcs.effective_from DESC
       LIMIT 1),
      false
    ) AS has_been_configured;
$$;

COMMENT ON FUNCTION get_current_monthly_fixed_costs_cents IS
  'v8.3 E9/D.3/D.13, fix auditoría externa 2026-07-31: devuelve el costo fijo '
  'mensual vigente Y un booleano has_been_configured explícito -- ya no se '
  'infiere "configurado" a partir de monto > 0 (ambiguo con un $0 real). '
  'Firma cambiada de INTEGER a TABLE; callers deben leer la primera fila.';

-- [FIX 2026-08-01] Al aplicar esta migración (295) a producción, el `db push`
-- falló en el `COMMENT ON FUNCTION set_current_fixed_costs IS ...` de abajo
-- con "could not find a function named set_current_fixed_costs" (SQLSTATE
-- 42883 -- undefined_function, no es ambigüedad de sobrecarga). Es decir: la
-- función de la migración 249 NUNCA llegó a existir realmente en producción,
-- a pesar de que el historial de `supabase_migrations.schema_migrations`
-- la marca como aplicada (esa marca vino de un `migration repair --status
-- applied` masivo para 001-250 hecho en una sesión anterior, basado en
-- evidencia de que OTROS objetos ya existían -- evidentemente no cubría
-- cada función individualmente). Consecuencia real y activa: cualquier
-- intento del dueño de guardar costos fijos mensuales desde
-- /admin/contabilidad (route.ts línea ~64, `.rpc("set_current_fixed_costs",
-- ...)`) fallaba en producción con un 500, silenciosamente, desde que se
-- "aplicó" la 249. Esta migración ahora recrea la función completa (idéntica
-- a la definición original de 249, CREATE OR REPLACE es idempotente y
-- seguro tanto si existía como si no) ANTES de comentarla, para que 295
-- quede auto-suficiente y además repare esta regresión real de producción.
CREATE OR REPLACE FUNCTION set_current_fixed_costs(
  p_monthly_fixed_costs_cents INTEGER,
  p_effective_from DATE,
  p_reason TEXT,
  p_created_by UUID
)
RETURNS TABLE (
  id UUID,
  monthly_fixed_costs_cents INTEGER,
  effective_from DATE,
  effective_to DATE,
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_id UUID;
  v_new_id UUID;
BEGIN
  IF NOT has_admin_role(auth.uid(), ARRAY['owner_admin']) THEN
    RAISE EXCEPTION 'set_current_fixed_costs: solo owner_admin puede editar costos fijos'
      USING ERRCODE = '42501';
  END IF;

  IF p_monthly_fixed_costs_cents IS NULL OR p_monthly_fixed_costs_cents < 0 THEN
    RAISE EXCEPTION 'set_current_fixed_costs: monthly_fixed_costs_cents debe ser >= 0'
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'set_current_fixed_costs: reason es requerido para el historial de auditoría'
      USING ERRCODE = '22023';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'set_current_fixed_costs: effective_from es requerido'
      USING ERRCODE = '22023';
  END IF;

  SELECT fcs.id INTO v_previous_id
  FROM fixed_costs_settings fcs
  WHERE fcs.effective_to IS NULL
  ORDER BY fcs.effective_from DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO fixed_costs_settings (monthly_fixed_costs_cents, effective_from, reason, created_by)
  VALUES (p_monthly_fixed_costs_cents, p_effective_from, p_reason, p_created_by)
  RETURNING fixed_costs_settings.id INTO v_new_id;

  IF v_previous_id IS NOT NULL THEN
    UPDATE fixed_costs_settings
    SET effective_to = p_effective_from - INTERVAL '1 day'
    WHERE fixed_costs_settings.id = v_previous_id;
  END IF;

  RETURN QUERY
  SELECT fcs.id, fcs.monthly_fixed_costs_cents, fcs.effective_from, fcs.effective_to,
         fcs.reason, fcs.created_by, fcs.created_at
  FROM fixed_costs_settings fcs
  WHERE fcs.id = v_new_id;
END;
$$;

-- [FIX 2026-08-01] A propósito NO se agrega REVOKE ALL FROM PUBLIC aquí (a
-- diferencia de funciones RPC llamadas con el service role, ej.
-- apply_batch_capture_result en 296): route.ts llama esta función con
-- `auth.supabase`, el cliente atado a la SESIÓN del admin (requireAdminRole),
-- no con el service role -- la función internamente valida
-- `has_admin_role(auth.uid(), ...)`, que solo resuelve auth.uid() para un
-- caller autenticado real. La definición original de 249 tampoco tenía
-- GRANT/REVOKE explícito (PostgreSQL otorga EXECUTE a PUBLIC por defecto al
-- crear una función), así que se preserva ese comportamiento -- restringir a
-- service_role habría roto la llamada real del endpoint.
COMMENT ON FUNCTION set_current_fixed_costs IS
  'Fix 2026-07-30 (auditoría de integridad financiera): versiona fixed_costs_settings de forma '
  'atómica -- INSERT de la fila nueva vigente + UPDATE de cierre (effective_to) de la anterior '
  'dentro de una sola transacción. Reemplaza el update-then-insert en dos pasos separados de '
  'src/app/api/admin/fixed-costs-settings/route.ts, que podía dejar la tabla sin ninguna fila '
  'vigente si el insert fallaba después de cerrar la fila anterior. Toda fila insertada por esta '
  'función es una configuración real del dueño: has_been_configured nace en true (DEFAULT de la '
  'columna, migración 295), a diferencia de la fila semilla de la migración 134. '
  '[FIX 2026-08-01] Recreada aquí (CREATE OR REPLACE idempotente) porque nunca existió '
  'realmente en producción pese a que 249 estaba marcada como aplicada -- ver comentario arriba.';
