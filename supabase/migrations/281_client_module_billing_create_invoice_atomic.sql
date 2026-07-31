-- Módulo de Cliente (facturación) -- fix de atomicidad, mismo patrón que
-- 268 (flujo de contratación) aplicado aquí.
--
-- Contexto del bug que esto corrige: invoice-service.ts (createInvoice)
-- originalmente hacía dos operaciones independientes sobre PostgREST vía
-- supabase-js -- INSERT en `client_invoices` y, si tenía éxito, INSERT en
-- `client_invoice_line_items` -- sin transacción real entre ambas (cada
-- `.from(...).insert(...)` es su propio round-trip HTTP). Se implementó un
-- saga con compensación (si el insert de líneas fallaba, se intentaba
-- borrar la factura recién creada) que funcionaba pero dejaba una ventana:
-- si la compensación TAMBIÉN fallaba (ej. caída de red justo en ese
-- instante), quedaba una factura en 'draft' sin ninguna línea -- un
-- registro fiscal huérfano e inconsistente, justo la clase de bug que
-- `OrphanedInvoiceError` existía para señalar (nunca para prevenir).
--
-- Fix: mismo patrón ya usado en 249 (set_current_fixed_costs), 252
-- (set_system_setting) y 268 (submit_step1_candidate, flujo de
-- contratación) -- una función RPC SECURITY DEFINER que hace el INSERT de
-- la factura y el de TODAS sus líneas dentro de una única transacción de
-- Postgres real. Si cualquier INSERT de línea falla, TODO se revierte
-- automáticamente -- ya no hace falta lógica de compensación manual en la
-- capa de aplicación (elimina la clase de error `OrphanedInvoiceError` del
-- lado TS, exactamente igual que 268 eliminó `OrphanedCandidateError`).
--
-- Por qué las líneas viajan como un solo parámetro JSONB
-- (`p_line_items`) en vez de N parámetros o N llamadas: PL/pgSQL no puede
-- recibir un array de "filas heterogéneas" (tipos + cantidad variable) de
-- forma nativa sin definir un tipo compuesto SQL dedicado. Un array JSONB
-- es el mecanismo más simple para pasar una cantidad variable de líneas
-- (0..N) en una sola llamada RPC (un solo round-trip HTTP), consistente
-- con cómo Supabase/PostgREST ya serializa objetos TS a JSONB de forma
-- transparente. `jsonb_array_elements` desnormaliza cada elemento a una
-- fila dentro del mismo `INSERT ... SELECT`, así que el costo de parseo es
-- el de Postgres, no un loop fila-por-fila en PL/pgSQL (aunque aquí sí se
-- usa un loop explícito por claridad -- ver comentario en el cuerpo).
--
-- Por qué se revalida aquí `jsonb_array_length(p_line_items) > 0`, a pesar
-- de que invoice-service.ts YA valida esto en TS antes de invocar la RPC:
-- misma razón que 268 revalida `consent_accepted` -- defensa en
-- profundidad, dado que esta función es SECURITY DEFINER y podría en
-- teoría invocarse desde otro caller en el futuro sin pasar por ese
-- chequeo de TS. Regla dura explícita del módulo: nunca una factura sin
-- líneas.
--
-- Por qué NO se recalculan aquí los totales (subtotal/gst/pst/total) a
-- partir de las líneas: ese cálculo (calculateInvoiceTotals,
-- billing-calculations.ts) es lógica de aplicación pura en TypeScript, ya
-- testeada exhaustivamente sin DB (redondeo por línea, tasas desde
-- system_settings) -- exactamente igual que 268 no reimplementa el
-- renderizado del texto legal en PL/pgSQL. Esta función solo persiste los
-- totales YA calculados que recibe como parámetros; no es su
-- responsabilidad re-derivarlos ni validarlos contra las líneas.

CREATE OR REPLACE FUNCTION create_client_invoice_with_line_items(
  p_client_id UUID,
  p_issue_date DATE,
  p_due_date DATE,
  p_subtotal_cents INTEGER,
  p_gst_amount_cents INTEGER,
  p_pst_amount_cents INTEGER,
  p_total_cents INTEGER,
  p_invoice_number TEXT,
  p_line_items JSONB
)
RETURNS client_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice client_invoices;
  v_line_item JSONB;
BEGIN
  -- Regla dura del módulo (ver invoice-service.ts: createInvoice): nunca
  -- una factura sin líneas. Se revalida aquí, dentro de la transacción, en
  -- vez de confiar únicamente en el chequeo previo de createInvoice --
  -- defensa en profundidad, mismo motivo que el guard de consentimiento en
  -- submit_step1_candidate (268).
  IF p_line_items IS NULL OR jsonb_array_length(p_line_items) = 0 THEN
    RAISE EXCEPTION 'create_client_invoice_with_line_items: p_line_items no puede estar vacío -- nunca se crea una factura sin líneas'
      USING ERRCODE = '22023';
  END IF;

  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'create_client_invoice_with_line_items: p_client_id es requerido'
      USING ERRCODE = '22023';
  END IF;

  IF p_invoice_number IS NULL OR length(trim(p_invoice_number)) = 0 THEN
    RAISE EXCEPTION 'create_client_invoice_with_line_items: p_invoice_number es requerido'
      USING ERRCODE = '22023';
  END IF;

  -- La factura SIEMPRE nace en 'draft' (regla de negocio explícita, ver
  -- invoice-service.ts: defaultInsertInvoice original) -- el envío/
  -- transición a 'sent' es una acción separada, fuera de esta función.
  -- balance_due_cents = p_total_cents y amount_paid_cents = 0 porque una
  -- factura recién creada no tiene ningún pago aplicado todavía --
  -- record_client_payment() (278) es quien mantiene esos dos campos
  -- consistentes después, de forma atómica con row lock.
  INSERT INTO client_invoices (
    client_id, invoice_number, issue_date, due_date, status,
    subtotal_cents, gst_amount_cents, pst_amount_cents, total_cents,
    amount_paid_cents, balance_due_cents
  ) VALUES (
    p_client_id, p_invoice_number, p_issue_date, p_due_date, 'draft',
    p_subtotal_cents, p_gst_amount_cents, p_pst_amount_cents, p_total_cents,
    0, p_total_cents
  )
  RETURNING * INTO v_invoice;

  -- Recorre p_line_items e inserta cada línea referenciando el id de la
  -- factura recién creada, TODO dentro de la misma transacción implícita
  -- de la función: si cualquier INSERT de esta vuelta falla (ej. un CHECK
  -- de client_invoice_line_items, como unit_price_cents >= 0), Postgres
  -- revierte automáticamente TANTO las líneas ya insertadas en este loop
  -- COMO el INSERT de la factura de arriba -- no queda ningún rastro
  -- parcial. Esto es exactamente lo que la saga-con-compensación anterior
  -- intentaba lograr manualmente (y podía fallar en el intento): acá lo
  -- hace Postgres solo, sin lógica de compensación en absoluto.
  FOR v_line_item IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    INSERT INTO client_invoice_line_items (
      invoice_id, property_service_id, description, quantity,
      unit_price_cents, amount_cents
    ) VALUES (
      v_invoice.id,
      NULLIF(v_line_item->>'property_service_id', '')::UUID,
      v_line_item->>'description',
      (v_line_item->>'quantity')::NUMERIC,
      (v_line_item->>'unit_price_cents')::INTEGER,
      (v_line_item->>'amount_cents')::INTEGER
    );
  END LOOP;

  RETURN v_invoice;
END;
$$;

COMMENT ON FUNCTION create_client_invoice_with_line_items IS
  'Módulo de Cliente / Facturación: inserta client_invoices + TODAS sus '
  'client_invoice_line_items en una sola transacción atómica (fix del '
  'saga-con-compensación original de invoice-service.ts, mismo patrón que '
  '268 en flujo de contratación). p_line_items es un array JSONB de '
  '{description, quantity, unit_price_cents, amount_cents, '
  'property_service_id}. Los totales (subtotal/gst/pst/total) ya deben '
  'venir calculados desde TS (billing-calculations.ts) -- esta función no '
  'los recalcula, solo los persiste.';

-- Mismo régimen de acceso que el resto del módulo: ni anon ni
-- authenticated pueden ejecutar esto directamente (client_invoices /
-- client_invoice_line_items son service-role-only, ver 276/277) --
-- SECURITY DEFINER solo tiene sentido protegido detrás del mismo
-- perímetro. Revocamos explícito en vez de confiar en el default, mismo
-- patrón que 268 y el resto de las funciones RPC de este repo.
REVOKE ALL ON FUNCTION create_client_invoice_with_line_items FROM PUBLIC;
REVOKE ALL ON FUNCTION create_client_invoice_with_line_items FROM anon;
REVOKE ALL ON FUNCTION create_client_invoice_with_line_items FROM authenticated;
GRANT EXECUTE ON FUNCTION create_client_invoice_with_line_items TO service_role;
