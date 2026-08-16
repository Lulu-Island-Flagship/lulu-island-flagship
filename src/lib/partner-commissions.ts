import { applyPercentRoundHalfUp } from "./money";

/**
 * v8.3 E10 (D.10.6) — Comisiones de partners. Función pura.
 * Todos los tipos requieren T4A (formulario CRA para pagos a no-empleados).
 */

export type PartnerType = "real_estate_agent" | "property_manager" | "veterinarian" | "builder";

export interface CommissionInput {
  partnerType: PartnerType;
  orderValueCents: number; // valor de la orden que generó la referencia
  isFirstBooking?: boolean; // relevante solo para real_estate_agent
}

export interface CommissionResult {
  amountCents: number;
  requiresT4A: boolean;
  description: string;
}

export function calculatePartnerCommission(input: CommissionInput): CommissionResult {
  switch (input.partnerType) {
    case "real_estate_agent": {
      if (!input.isFirstBooking) {
        return {
          amountCents: 0,
          requiresT4A: true,
          description: "Agente inmobiliario: comisión solo aplica a la primera reserva del cliente referido.",
        };
      }
      return {
        amountCents: Number(applyPercentRoundHalfUp(BigInt(input.orderValueCents), 10)),
        requiresT4A: true,
        description: "Agente inmobiliario: 10% de la primera reserva.",
      };
    }
    case "property_manager":
      return {
        amountCents: Number(applyPercentRoundHalfUp(BigInt(input.orderValueCents), 5)),
        requiresT4A: true,
        description: "Property manager: 5% mensual (recurrente, no solo primera reserva).",
      };
    case "veterinarian":
      return {
        amountCents: 2000, // $20 fijo
        requiresT4A: true,
        description: "Veterinario: $20 fijo por referencia.",
      };
    case "builder":
      return {
        amountCents: Math.round(input.orderValueCents * 0.15),
        requiresT4A: true,
        description: "Constructor: 15% de la orden referida.",
      };
    default:
      return { amountCents: 0, requiresT4A: false, description: "Tipo de partner desconocido." };
  }
}
