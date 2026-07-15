/**
 * v8.3 E7 (D.7.6, punto 6) — recordatorio 48h + alerta stock-out 72h de
 * órdenes de compra pendientes de aprobación.
 *
 * Las columnas `purchase_orders.reminder_sent_at` y `.stockout_alert_sent_at`
 * existen desde la migración 048 (E7 original) pero nunca se poblaban:
 * ningún cron ni ruta las escribía. Este módulo es la lógica pura de
 * decisión; el cron en `src/app/api/cron/purchase-order-reminders/route.ts`
 * la usa para decidir qué actualizar.
 *
 * Reglas:
 *  - Si la PO sigue en 'pending_approval' >= 48h desde su creación y aún no
 *    se envió el recordatorio, se debe enviar (marcar reminder_sent_at).
 *  - Si sigue en 'pending_approval' >= 72h desde su creación y aún no se
 *    envió la alerta de stock-out, se debe enviar (marcar
 *    stockout_alert_sent_at). Esto es independiente del recordatorio de 48h
 *    (si por lo que sea el cron no corrió a las 48h, igual se dispara el de
 *    72h al llegar el umbral).
 *  - Una PO que ya salió de 'pending_approval' (approved/ordered/received/
 *    cancelled) no debe seguir generando recordatorios: ya fue atendida.
 */

const REMINDER_THRESHOLD_HOURS = 48;
const STOCKOUT_ALERT_THRESHOLD_HOURS = 72;

export interface PendingPurchaseOrder {
  id: string;
  status: string;
  createdAt: string; // ISO
  reminderSentAt: string | null;
  stockoutAlertSentAt: string | null;
}

export interface EscalationDecision {
  id: string;
  hoursSinceCreated: number;
  shouldSendReminder: boolean;
  shouldSendStockoutAlert: boolean;
}

function hoursBetween(fromIso: string, toIso: string): number {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  return (toMs - fromMs) / (1000 * 60 * 60);
}

/**
 * Evalúa una sola PO pendiente contra los umbrales de 48h/72h.
 * Función pura: no toca la base de datos, solo decide.
 */
export function evaluatePurchaseOrderEscalation(
  po: PendingPurchaseOrder,
  nowIso: string
): EscalationDecision {
  // Solo las que siguen pendientes de aprobación generan recordatorio; una
  // vez aprobada/ordenada/recibida/cancelada, ya no aplica (fue atendida).
  if (po.status !== "pending_approval") {
    return { id: po.id, hoursSinceCreated: 0, shouldSendReminder: false, shouldSendStockoutAlert: false };
  }

  const hoursSinceCreated = hoursBetween(po.createdAt, nowIso);

  const shouldSendReminder =
    po.reminderSentAt === null && hoursSinceCreated >= REMINDER_THRESHOLD_HOURS;

  const shouldSendStockoutAlert =
    po.stockoutAlertSentAt === null && hoursSinceCreated >= STOCKOUT_ALERT_THRESHOLD_HOURS;

  return { id: po.id, hoursSinceCreated, shouldSendReminder, shouldSendStockoutAlert };
}

/**
 * Evalúa una lista completa y devuelve solo las que requieren alguna acción
 * (recordatorio y/o alerta stock-out), para que el cron sepa exactamente
 * qué filas escribir.
 */
export function evaluatePendingPurchaseOrders(
  pos: PendingPurchaseOrder[],
  nowIso: string
): EscalationDecision[] {
  return pos
    .map((po) => evaluatePurchaseOrderEscalation(po, nowIso))
    .filter((d) => d.shouldSendReminder || d.shouldSendStockoutAlert);
}
