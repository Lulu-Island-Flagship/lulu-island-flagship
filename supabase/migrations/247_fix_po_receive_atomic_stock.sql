-- Fix (auditoría 2026-07-30, integridad financiera): recepción de PO no
-- atómica en src/app/api/admin/purchase-orders/[id]/approve/route.ts.
--
-- Secuencia anterior (acción "receive", aprox líneas 165-205 antes de este
-- fix):
--   1. UPDATE purchase_orders SET status = 'received' ... (CAS correcto,
--      esto SÍ estaba bien).
--   2. Por cada línea de la PO: SELECT current_stock, sumar en JS
--      (read-modify-write), UPDATE inventory_items.
--   3. Si el paso 2 fallaba para alguna línea, el error se acumulaba en
--      `stockUpdateErrors` mas la respuesta seguía siendo 200 y la PO
--      quedaba "received" con el stock real sin reponer -- exactamente el
--      bug original que esta tabla existe para resolver (ver migración
--      048/242): el motor de reposición vuelve a correr sobre un número
--      congelado, en silencio.
--   4. El read-modify-write en JS (leer, sumar, escribir en llamadas
--      separadas) es además propenso a "lost update" bajo concurrencia:
--      dos recepciones simultáneas de la misma línea pueden pisarse.
--
-- Mismo patrón que commit_capacity_slot (migración 242) y
-- apply_wallet_delta (migraciones 180/233): una función RPC de Postgres
-- que hace SELECT ... FOR UPDATE sobre la PO, valida el estado DENTRO de
-- la misma transacción, incrementa current_stock con SQL atómico
-- (current_stock = current_stock + cantidad, no round-trip a la app) para
-- cada línea, y recién al final mueve el estado a 'received'. Si CUALQUIER
-- paso falla (línea con inventory_item_id inexistente, etc.), toda la
-- función se revierte -- la PO nunca queda "received" con stock a medio
-- reponer, y el caller nunca puede reportar éxito (200) sobre un fallo
-- parcial porque la excepción se propaga y el endpoint responde con error.
--
-- Diferencia con commit_capacity_slot: ese RPC se restringe a
-- service_role/postgres/supabase_admin porque se llama desde el checkout
-- público (src/app/api/stripe/confirm/route.ts) vía getServiceRoleClient().
-- Este endpoint admin usa el cliente anon+cookies de requireAdminRole()
-- (auth.supabase), autenticado como el admin de la sesión -- por eso la
-- autorización aquí se hace con is_supervisor(auth.uid()), la misma
-- función que ya protege las políticas RLS de purchase_orders,
-- purchase_order_lines e inventory_items (migración 048).

CREATE OR REPLACE FUNCTION receive_purchase_order(p_po_id UUID)
RETURNS TABLE (
  po_id UUID,
  status TEXT,
  received_at TIMESTAMPTZ,
  lines_updated INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_deleted_at TIMESTAMPTZ;
  v_line RECORD;
  v_lines_updated INTEGER := 0;
  v_received_at TIMESTAMPTZ := now();
  v_rows_affected INTEGER;
BEGIN
  IF NOT is_supervisor(auth.uid()) THEN
    RAISE EXCEPTION 'receive_purchase_order: solo supervisores pueden recibir órdenes de compra'
      USING ERRCODE = '42501';
  END IF;

  -- Bloquea la fila de la PO hasta el COMMIT: serializa recepciones
  -- concurrentes de la misma orden y elimina la ventana de "lost update"
  -- que tenía el read-modify-write en JS.
  SELECT po.status, po.deleted_at
  INTO v_status, v_deleted_at
  FROM purchase_orders po
  WHERE po.id = p_po_id
  FOR UPDATE;

  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'purchase_orders row % not found' , p_po_id USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'ordered' THEN
    RAISE EXCEPTION
      'receive_purchase_order: estado actual es ''%'', se requiere ''ordered''', v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Incremento atómico en SQL (no read-modify-write en la aplicación): el
  -- propio UPDATE hace current_stock = current_stock + cantidad en una
  -- sola sentencia, sin ventana entre leer y escribir.
  FOR v_line IN
    SELECT inventory_item_id, quantity
    FROM purchase_order_lines
    WHERE purchase_order_id = p_po_id
      AND inventory_item_id IS NOT NULL
      AND quantity IS NOT NULL
  LOOP
    UPDATE inventory_items
    SET current_stock = current_stock + v_line.quantity
    WHERE id = v_line.inventory_item_id;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected = 0 THEN
      -- Línea apunta a un inventory_item que ya no existe: abortamos toda
      -- la transacción en vez de reponer solo parte del stock y marcar la
      -- PO como recibida de todos modos.
      RAISE EXCEPTION
        'receive_purchase_order: inventory_items % no encontrado (línea de PO %)',
        v_line.inventory_item_id, p_po_id
        USING ERRCODE = 'P0002';
    END IF;

    v_lines_updated := v_lines_updated + 1;
  END LOOP;

  -- Solo si TODAS las líneas se repusieron sin error se marca la PO como
  -- recibida -- todo o nada.
  UPDATE purchase_orders
  SET status = 'received', received_at = v_received_at
  WHERE id = p_po_id;

  RETURN QUERY SELECT p_po_id, 'received'::TEXT, v_received_at, v_lines_updated;
END;
$$;

COMMENT ON FUNCTION receive_purchase_order IS
  'Fix 2026-07-30 (auditoría de integridad financiera): recepción atómica de una PO -- '
  'repone inventory_items.current_stock con SQL atómico (current_stock = current_stock + cantidad) '
  'para cada línea y solo entonces mueve purchase_orders.status a ''received'', todo dentro de la '
  'misma transacción (SELECT ... FOR UPDATE + validación + updates). Si cualquier línea falla, toda '
  'la función se revierte y la PO permanece en ''ordered'' -- reemplaza el read-modify-write en JS '
  'de src/app/api/admin/purchase-orders/[id]/approve/route.ts que podía dejar la PO "received" con '
  'stock parcialmente repuesto y devolver 200 sobre un fallo parcial.';
