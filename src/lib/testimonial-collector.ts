/**
 * v8.3 E10 (H.4) — Recolección sistemática de testimonios post-servicio.
 *
 * Flujo:
 *   1. Post-servicio, si el score QC del servicio > 95 → se dispara solicitud
 *      de reseña de 1 clic: "Tu opinión en 1 clic ⭐⭐⭐⭐⭐".
 *   2. Si el cliente da 5★ → se le piden 2 frases → se publica como testimonial
 *      público (nombre, zona, texto, fecha).
 *   3. Si el cliente da < 4★ → NO se publica. En su lugar, se abre un ticket
 *      de QC automático para investigar la insatisfacción antes de que escale.
 *   4. Los testimonios 5★ se auto-publican en Google Business Profile vía API
 *      (el caller es responsable de la integración real con GBP API).
 *
 * Conecta review-delivery.ts para construir links de reseña seguros y validar
 * que no haya disputas críticas abiertas (invariante B.2.18: solo se excluye
 * la solicitud si hay una disputa crítica activa).
 */

import {
  buildReviewLink,
  type OpenTicketRef,
  hasOpenCriticalDispute,
} from "./review-delivery";

// ── Umbrales ──────────────────────────────────────────────────────────────────

/** Score QC mínimo para disparar la solicitud de reseña de 1 clic. */
export const TESTIMONIAL_QC_SCORE_THRESHOLD = 95;

/** Rating ≥ 4★ se considera positivo (el umbral de "no publicar" es < 4★). */
export const TESTIMONIAL_POSITIVE_RATING_THRESHOLD = 4;

/** Rating = 5★ permite pedir testimonial público. */
export const TESTIMONIAL_FIVE_STAR = 5;

// ── Estados de la solicitud ───────────────────────────────────────────────────

/** Estados del ciclo de vida de una solicitud de testimonial. */
export type TestimonialRequestStatus =
  | "pending"
  | "rating_given"
  | "testimonial_collected"
  | "qc_ticket_opened"
  | "published"
  | "declined";

/** Una solicitud de testimonial ligada a una orden completada. */
export interface TestimonialRequest {
  requestId: string;
  orderId: string;
  clientId: string;
  clientName: string;
  clientZone: string;
  serviceScore: number; // score QC del servicio (0-100)
  reviewToken: string;
  status: TestimonialRequestStatus;
  createdAt: string;
  /** Rating que dio el cliente (1-5, null si aún no responde). */
  clientRating?: number;
  /** Texto del testimonial (si el cliente dio 5★ y escribió 2 frases). */
  testimonialText?: string;
  /** Fecha en que se publicó (ISO). */
  publishedAt?: string;
  /** ID del ticket QC abierto (si rating < 4★). */
  qcTicketId?: string;
}

// ── Disparo de solicitud ──────────────────────────────────────────────────────

/**
 * Determina si un servicio califica para recibir solicitud de reseña de 1 clic.
 * Condiciones:
 *   1. Score QC del servicio > 95 (servicio de élite).
 *   2. No hay disputa crítica abierta (invariante B.2.18).
 *
 * @param serviceScore — score QC del servicio completado (0-100).
 * @param openTickets — tickets/disputas abiertas de la orden.
 */
export function shouldRequestTestimonial(
  serviceScore: number,
  openTickets: OpenTicketRef[],
): { eligible: boolean; reason?: string } {
  if (hasOpenCriticalDispute(openTickets)) {
    return {
      eligible: false,
      reason:
        "La orden tiene una disputa crítica abierta — no se solicita reseña hasta resolverse (invariante B.2.18).",
    };
  }

  if (serviceScore <= TESTIMONIAL_QC_SCORE_THRESHOLD) {
    return {
      eligible: false,
      reason: `Score QC del servicio (${serviceScore}) no supera el umbral de ${TESTIMONIAL_QC_SCORE_THRESHOLD}.`,
    };
  }

  return { eligible: true };
}

// ── Procesamiento de rating ───────────────────────────────────────────────────

/**
 * Procesa el rating que dio el cliente (1-5 estrellas).
 *
 * - 5★ → pasa a "rating_given", listo para pedir testimonial.
 * - 4★ → positivo pero no excepcional — se registra, sin más acción.
 * - <4★ → abre ticket QC automático (estado "qc_ticket_opened").
 */
export function processClientRating(
  request: TestimonialRequest,
  rating: number,
  _nowIso: string,
): {
  updatedRequest: TestimonialRequest;
  shouldAskForTestimonial: boolean;
  shouldOpenQcTicket: boolean;
} {
  if (rating < 1 || rating > 5) {
    throw new Error(`Rating inválido: ${rating}. Debe estar entre 1 y 5.`);
  }

  const updated: TestimonialRequest = {
    ...request,
    clientRating: rating,
    status: "rating_given",
  };

  // < 4★ → abre ticket QC, NO publica
  if (rating < TESTIMONIAL_POSITIVE_RATING_THRESHOLD) {
    return {
      updatedRequest: {
        ...updated,
        status: "qc_ticket_opened",
      },
      shouldAskForTestimonial: false,
      shouldOpenQcTicket: true,
    };
  }

  // 5★ → pedir testimonial de 2 frases
  if (rating === TESTIMONIAL_FIVE_STAR) {
    return {
      updatedRequest: updated,
      shouldAskForTestimonial: true,
      shouldOpenQcTicket: false,
    };
  }

  // 4★: positivo, no se pide testimonial extra, no se abre QC
  return {
    updatedRequest: { ...updated, status: "declined" },
    shouldAskForTestimonial: false,
    shouldOpenQcTicket: false,
  };
}

// ── Publicación de testimonial ────────────────────────────────────────────────

/**
 * Valida que un testimonial de 2 frases es publicable:
 *   - No vacío.
 *   - Mínimo 2 frases (separadas por '.', '!', o '?' seguido de espacio).
 *   - Longitud mínima total: 20 caracteres.
 *   - Longitud máxima: 500 caracteres.
 */
export function isValidTestimonialText(text: string): {
  valid: boolean;
  reason?: string;
} {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: "El testimonial no puede estar vacío." };
  }

  if (trimmed.length < 20) {
    return {
      valid: false,
      reason: `El testimonial es demasiado corto (${trimmed.length} caracteres, mínimo 20).`,
    };
  }

  if (trimmed.length > 500) {
    return {
      valid: false,
      reason: `El testimonial excede el máximo de 500 caracteres (${trimmed.length}).`,
    };
  }

  // Contar frases: oraciones terminadas en . ! ?
  const sentences = trimmed.split(/[.!?]\s+/).filter(Boolean);
  if (sentences.length < 2) {
    return {
      valid: false,
      reason: "El testimonial debe tener al menos 2 frases.",
    };
  }

  return { valid: true };
}

/**
 * Publica el testimonial: registra el texto y cambia el estado a "published".
 * El caller es responsable de persistir y de publicar en GBP vía API.
 */
export function publishTestimonial(
  request: TestimonialRequest,
  testimonialText: string,
  nowIso: string,
): { request: TestimonialRequest; validation: ReturnType<typeof isValidTestimonialText> } {
  const validation = isValidTestimonialText(testimonialText);

  if (!validation.valid) {
    return {
      request,
      validation,
    };
  }

  return {
    request: {
      ...request,
      testimonialText: testimonialText.trim(),
      status: "published",
      publishedAt: nowIso,
    },
    validation,
  };
}

// ── Generación del mensaje de solicitud ───────────────────────────────────────

/**
 * Genera el mensaje de solicitud de reseña de 1 clic.
 * Si el cliente ya dio rating, el mensaje se adapta a la etapa actual.
 */
export function buildTestimonialRequestMessage(
  request: TestimonialRequest,
  baseUrl: string,
): string {
  const link = buildReviewLink(request.reviewToken, baseUrl);

  switch (request.status) {
    case "pending":
      return `¡Tu servicio obtuvo un score de calidad de ${request.serviceScore}/100! 🌟 Tu opinión en 1 clic: ${link}`;

    case "rating_given":
      return `¡Gracias por tus ${request.clientRating} estrellas! ¿Nos ayudas con 2 frases sobre tu experiencia? ${link}`;

    case "published":
      return `¡Tu testimonial ya está publicado! Gracias por ayudarnos a crecer. ${link}`;

    default:
      return `Gracias por confiar en Lulu Island Flagship. ${link}`;
  }
}

// ── Estructura de QC ticket (para el caller) ──────────────────────────────────

/** Datos mínimos para abrir un ticket QC por insatisfacción. */
export interface QcTicketRequest {
  orderId: string;
  clientId: string;
  clientName: string;
  clientZone: string;
  serviceScore: number;
  clientRating: number;
  reason: string;
  priority: "high" | "medium" | "low";
}

/**
 * Construye la solicitud de ticket QC para cuando un cliente da < 4★.
 * Prioridad: "high" si rating = 1-2★, "medium" si 3★.
 */
export function buildQcTicketFromLowRating(
  request: TestimonialRequest,
): QcTicketRequest {
  const rating = request.clientRating ?? 0;
  const priority: QcTicketRequest["priority"] = rating <= 2 ? "high" : "medium";

  return {
    orderId: request.orderId,
    clientId: request.clientId,
    clientName: request.clientName,
    clientZone: request.clientZone,
    serviceScore: request.serviceScore,
    clientRating: rating,
    reason: `Cliente ${request.clientName} calificó con ${rating}★ tras un servicio con score QC de ${request.serviceScore}/100. Se requiere investigación antes de que escale a disputa.`,
    priority,
  };
}

// ── ROI de testimonios ────────────────────────────────────────────────────────

/** Métricas del programa de recolección de testimonios. */
export interface TestimonialMetrics {
  /** Servicios con score > 95 (elegibles para solicitud). */
  eligibleServices: number;
  /** Solicitudes de testimonial enviadas. */
  requestsSent: number;
  /** Clientes que dieron rating. */
  ratingsReceived: number;
  /** Testimonios 5★ publicados. */
  testimonialsPublished: number;
  /** Tickets QC abiertos por rating < 4★. */
  qcTicketsOpened: number;
  /** Nuevos clientes que mencionaron "vi un testimonial" como canal. */
  clientsFromTestimonials: number;
}

/**
 * Calcula la tasa de conversión del funnel de testimonios.
 */
export function calculateTestimonialFunnel(
  metrics: TestimonialMetrics,
): {
  responseRatePercent: number;
  fiveStarRatePercent: number;
  qcTicketRatePercent: number;
  testimonialConversionRatePercent: number;
} {
  const responseRatePercent =
    metrics.requestsSent > 0
      ? Math.round((metrics.ratingsReceived / metrics.requestsSent) * 1000) / 10
      : 0;

  const fiveStarRatePercent =
    metrics.ratingsReceived > 0
      ? Math.round(
          (metrics.testimonialsPublished / metrics.ratingsReceived) * 1000
        ) / 10
      : 0;

  const qcTicketRatePercent =
    metrics.ratingsReceived > 0
      ? Math.round(
          (metrics.qcTicketsOpened / metrics.ratingsReceived) * 1000
        ) / 10
      : 0;

  const testimonialConversionRatePercent =
    metrics.testimonialsPublished > 0
      ? Math.round(
          (metrics.clientsFromTestimonials / metrics.testimonialsPublished) * 1000
        ) / 10
      : 0;

  return {
    responseRatePercent,
    fiveStarRatePercent,
    qcTicketRatePercent,
    testimonialConversionRatePercent,
  };
}
