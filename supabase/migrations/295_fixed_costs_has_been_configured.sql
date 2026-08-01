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

-- set_current_fixed_costs (249) ya inserta filas nuevas con
-- has_been_configured=true por el DEFAULT de la columna -- no requiere
-- cambios. Se documenta explícitamente en su función para dejar constancia.
COMMENT ON FUNCTION set_current_fixed_costs IS
  'Fix 2026-07-30 (auditoría de integridad financiera): versiona fixed_costs_settings de forma '
  'atómica -- INSERT de la fila nueva vigente + UPDATE de cierre (effective_to) de la anterior '
  'dentro de una sola transacción. Reemplaza el update-then-insert en dos pasos separados de '
  'src/app/api/admin/fixed-costs-settings/route.ts, que podía dejar la tabla sin ninguna fila '
  'vigente si el insert fallaba después de cerrar la fila anterior. Toda fila insertada por esta '
  'función es una configuración real del dueño: has_been_configured nace en true (DEFAULT de la '
  'columna, migración 295), a diferencia de la fila semilla de la migración 134.';
