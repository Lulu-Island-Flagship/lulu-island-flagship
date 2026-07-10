/**
 * v8.3 E10 (D.10.7) — Contenido educativo (blog). Funciones puras del flujo
 * de estado y aprobación. El generador de texto con IA real NO se construye
 * aquí (necesita integración pagada + contenido real del negocio); el campo
 * `content` nace vacío y lo llena un paso posterior. Esta pieza se enfoca en
 * lo que el spec sí define literalmente: metadata anónima de origen, flujo
 * de aprobación de un toque, y el validador PIPA (B.2.20) como paso
 * obligatorio antes de publicar — nunca opcional, nunca saltable.
 *
 * Reutiliza pipa-validator.ts en vez de duplicar reglas: un blog post pasa
 * por la MISMA función que cualquier otra pieza de marketing.
 */

import { validateMarketingCopy, type PipaValidationOptions, type PipaViolation } from "./pipa-validator";

export type BlogPostStatus = "draft" | "pending_approval" | "approved" | "published" | "rejected";

/**
 * El tema del post nace de metadata AGREGADA y anónima (ej. "moho superficial
 * aparece con frecuencia en baños sin ventilación"), nunca de un cliente
 * individual. `sampleSize` es cuántos servicios/clientes distintos agregó el
 * tema — igual que get_wellbeing_aggregate en E8, un tamaño de muestra bajo
 * hace que el agregado equivalga a identificar a alguien, así que no cuenta
 * como anónimo de verdad.
 */
export interface AnonymizedSourceMetadata {
  triggerType: string; // ej. "recurring_stain_pattern", "seasonal_demand", "service_category"
  sampleSize: number;
}

const MIN_ANONYMOUS_SAMPLE_SIZE = 3;

/**
 * Un agregado de 1 o 2 casos no es anónimo: es fácil de rastrear al cliente
 * específico que lo originó. Mismo principio que la tabla daily_checkins
 * (E8): nunca exponer grupos tan chicos que equivalgan a identificar a uno.
 */
export function isSourceMetadataAnonymous(metadata: AnonymizedSourceMetadata): boolean {
  return metadata.sampleSize >= MIN_ANONYMOUS_SAMPLE_SIZE;
}

export interface BlogPost {
  id: string;
  title: string;
  content: string; // vacío hasta que el generador (fuera de alcance) lo llene
  sourceMetadata: AnonymizedSourceMetadata;
  status: BlogPostStatus;
  createdAt: string;
  approvedAt?: string;
  approvedByAdminId?: string;
  publishedAt?: string;
}

export interface PostEvaluationResult {
  readyForApproval: boolean;
  reasons: string[];
  pipaViolations: PipaViolation[];
}

/**
 * Evalúa si un borrador con contenido ya generado puede pasar a
 * "pending_approval". Dos condiciones, ambas obligatorias:
 *   1. La metadata de origen es genuinamente anónima (muestra suficiente).
 *   2. El contenido pasa el validador PIPA.
 * Un post con contenido vacío nunca está listo (nada que aprobar todavía).
 */
export function evaluatePostForApproval(
  post: Pick<BlogPost, "content" | "sourceMetadata">,
  pipaOptions: PipaValidationOptions = {}
): PostEvaluationResult {
  const reasons: string[] = [];

  if (!post.content || post.content.trim().length === 0) {
    return { readyForApproval: false, reasons: ["El post no tiene contenido generado todavía."], pipaViolations: [] };
  }

  if (!isSourceMetadataAnonymous(post.sourceMetadata)) {
    reasons.push(
      `Metadata de origen no es suficientemente anónima (muestra=${post.sourceMetadata.sampleSize}, mínimo=${MIN_ANONYMOUS_SAMPLE_SIZE}).`
    );
  }

  const pipaResult = validateMarketingCopy(post.content, pipaOptions);
  if (!pipaResult.passes) {
    reasons.push("El contenido no pasa el validador PIPA.");
  }

  return {
    readyForApproval: reasons.length === 0,
    reasons,
    pipaViolations: pipaResult.violations,
  };
}

export interface ApprovalResult {
  success: boolean;
  reason: string;
  newStatus?: BlogPostStatus;
}

/**
 * Aprobación de un toque (spec: "semanal con aprobación"). Defensa en
 * profundidad: esta función vuelve a exigir que el post esté en
 * "pending_approval" (nunca se puede aprobar un draft crudo saltándose
 * evaluatePostForApproval) y no confía ciegamente en una bandera externa.
 */
export function approvePost(post: Pick<BlogPost, "status">, adminId: string): ApprovalResult {
  if (post.status !== "pending_approval") {
    return {
      success: false,
      reason: `No se puede aprobar un post en estado '${post.status}'. Debe estar en 'pending_approval'.`,
    };
  }
  if (!adminId) {
    return { success: false, reason: "Se requiere el id del admin que aprueba (aprobación de un toque, no anónima)." };
  }
  return { success: true, reason: "Aprobado.", newStatus: "approved" };
}

/**
 * Publicar exige estado 'approved' — nunca se publica directo desde
 * 'pending_approval' ni desde 'draft', ni siquiera si el contenido pasaría
 * el validador PIPA por sí solo (el punto de aprobación humana es
 * obligatorio, no un atajo).
 */
export function publishPost(post: Pick<BlogPost, "status">): ApprovalResult {
  if (post.status !== "approved") {
    return {
      success: false,
      reason: `No se puede publicar un post en estado '${post.status}'. Debe estar en 'approved'.`,
    };
  }
  return { success: true, reason: "Publicado.", newStatus: "published" };
}

export function rejectPost(post: Pick<BlogPost, "status">): ApprovalResult {
  if (post.status === "published") {
    return { success: false, reason: "No se puede rechazar un post ya publicado (usar despublicación aparte)." };
  }
  return { success: true, reason: "Rechazado.", newStatus: "rejected" };
}
