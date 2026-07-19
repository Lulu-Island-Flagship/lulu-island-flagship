-- Migración 187 — v8.3 E2 (Viaje del Dinero), bug ALTO de auditoría:
-- src/app/api/cron/qbo-sync/route.ts insertaba una fila nueva en
-- qbo_export_lines en cada corrida del cron sin verificar si ya existía
-- una línea para esa orden. Como el adaptador QBO real todavía no está
-- conectado (pushResult.status === "not_configured"), orders.qbo_export_status
-- nunca pasa a "exported", así que la misma orden vuelve a calificar en
-- la siguiente corrida (mientras siga dentro de la ventana de 24h) y el
-- cron insertaba OTRA línea duplicada -- inflando total_gross/total_fees/
-- total_net en qbo_exports y duplicando ingresos reportados a QuickBooks
-- cuando el proveedor real se conecte.
--
-- No usamos UNIQUE(order_id) a secas porque una misma orden puede
-- legítimamente tener varias líneas con distinto transaction_type
-- (p.ej. 'capture' insertada por /api/cron/batch-capture y 'sales_receipt'
-- insertada por /api/cron/qbo-sync, o 'refund'/'chargeback' más tarde).
-- El duplicado real es "misma orden + mismo tipo de transacción", así que
-- la clave de idempotencia es (order_id, transaction_type).

-- Antes de crear el índice único, limpiar duplicados existentes
-- (si los hay) quedándonos con la línea más antigua de cada grupo, para
-- que la migración no falle en un entorno con datos previos.
DELETE FROM qbo_export_lines a
USING qbo_export_lines b
WHERE a.order_id IS NOT NULL
  AND a.order_id = b.order_id
  AND a.transaction_type = b.transaction_type
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS qbo_export_lines_order_type_unique
  ON qbo_export_lines (order_id, transaction_type)
  WHERE order_id IS NOT NULL;

COMMENT ON INDEX qbo_export_lines_order_type_unique IS
  'Idempotencia del sync a QBO: una orden no puede tener dos líneas del mismo transaction_type. Los crons (qbo-sync, batch-capture) deben usar upsert con onConflict "order_id,transaction_type".';
