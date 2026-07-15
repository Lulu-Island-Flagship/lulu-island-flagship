/**
 * v8.3 E8.7 — "Preparación por servicio": move-out 'cliente estresado,
 * paciencia alta'; post-construcción 'N95, ventilar'; mascotas con foto y
 * nombres; cliente nuevo 'primera impresión crítica'; historial de disputa
 * 'fotos en TODAS las zonas, no upsell sin aprobación'.
 *
 * Función pura: recibe los datos ya consultados (tipo de servicio, mascotas,
 * si el cliente es nuevo, si tiene disputas previas) y arma la lista de
 * tips contextuales. No fabrica datos que el sistema no tiene -- p.ej. no
 * existe foto/nombre de mascota en el esquema hoy (solo pets_count/
 * pets_type), así que el tip de mascotas solo usa lo que es real.
 */

export type ServiceType = "regular" | "deep" | "move_in_out" | "post_construction";

export interface ServiceBriefingInput {
  serviceType: ServiceType;
  petsCount: number;
  petsType: string; // 'none' | tipo declarado en la cotización
  isNewClient: boolean; // client_profiles.services_count === 0 antes de esta orden
  hasDisputeHistory: boolean; // client_profiles.disputes_count > 0
}

export type BriefingSeverity = "info" | "caution" | "critical";

export interface BriefingTip {
  key: string;
  message: string;
  severity: BriefingSeverity;
}

export function buildServiceBriefing(input: ServiceBriefingInput): BriefingTip[] {
  const tips: BriefingTip[] = [];

  if (input.serviceType === "move_in_out") {
    tips.push({
      key: "move_out_stress",
      message: "Move-in/out: el cliente suele estar estresado por la mudanza. Paciencia alta, comunicación clara.",
      severity: "caution",
    });
  }

  if (input.serviceType === "post_construction") {
    tips.push({
      key: "post_construction_ppe",
      message: "Post-construcción: usar N95 y ventilar el espacio antes de empezar (polvo fino).",
      severity: "caution",
    });
  }

  if (input.petsCount > 0) {
    tips.push({
      key: "pets_present",
      message: `Hay ${input.petsCount} mascota(s) en la propiedad (tipo declarado: ${input.petsType}). Confirmar con el cliente dónde estarán durante el servicio.`,
      severity: "info",
    });
  }

  if (input.isNewClient) {
    tips.push({
      key: "new_client",
      message: "Cliente nuevo: primera impresión crítica. Preséntense, expliquen el proceso brevemente.",
      severity: "info",
    });
  }

  if (input.hasDisputeHistory) {
    tips.push({
      key: "dispute_history",
      message: "Este cliente tiene disputas previas: fotos en TODAS las zonas al cierre, sin excepción. No ofrecer upsell sin aprobación del admin.",
      severity: "critical",
    });
  }

  return tips;
}
