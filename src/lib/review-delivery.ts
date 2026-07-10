/**
 * v8.3 E5.8 / E6 — Entrega real del token de reseña (invariante B.2.18).
 *
 * El token (`orders.review_token`) ya se genera solo del lado de base de
 * datos al completar la orden (trigger `generate_review_token_trigger`,
 * migración 014). Lo que faltaba era construir el link/QR y efectivamente
 * enviarlo — este módulo hace la parte de construcción (pura, testeable);
 * el envío por SMS vive en src/lib/send-communication.ts + src/lib/sms.ts.
 */
import QRCode from "qrcode";

/** Construye el link firmado de evaluación post-servicio para un token dado. */
export function buildReviewLink(reviewToken: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/evaluar/${reviewToken}`;
}

/**
 * Genera el QR del link de reseña como SVG (string, no imagen binaria) para
 * exhibirlo en la tablet del líder en el instante de aprobación física
 * (E5.8: "SMS/QR ... en el instante de aprobación física") y para
 * persistirlo junto a la orden sin depender de un servicio externo de
 * renderizado de imágenes.
 */
export async function buildReviewQrSvg(
  reviewToken: string,
  baseUrl: string
): Promise<string> {
  const link = buildReviewLink(reviewToken, baseUrl);
  return QRCode.toString(link, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

export interface OpenTicketRef {
  type: string;
  priority: string;
  status: string;
}

/**
 * Invariante B.2.18 (anti-gating): "Solicitud de reseña a TODOS los
 * servicios que completan el Protocolo de Cierre Externo. Única exclusión:
 * discrepancia crítica aún abierta, documentada como parte del flujo de
 * resolución." Una discrepancia/disputa es "crítica" cuando su prioridad es
 * 'high' (tickets_disputas.priority) y sigue 'open' o 'in_review'
 * (tickets_disputas, migración 001). Cualquier otro ticket (prioridad
 * media/baja, o ya resuelto) NO excluye la solicitud de reseña — el
 * anti-gating exige la solicitud como regla, la excepción es angosta a
 * propósito.
 */
export function hasOpenCriticalDispute(tickets: OpenTicketRef[]): boolean {
  return tickets.some(
    (t) =>
      (t.type === "dispute" || t.type === "discrepancy") &&
      t.priority === "high" &&
      (t.status === "open" || t.status === "in_review")
  );
}
