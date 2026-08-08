// ─── Mapper: EmployeeService ───────────────────────────────────
// v8.3 H6 (auditoría 2026-08-06): EmployeeService es una vista
// compuesta de 4 tablas (assignments + orders + quotes + profiles).
// Antes, cada ruta API construía este DTO manualmente con mapeo
// snake_case → camelCase inline. Este mapper centraliza esa
// transformación y aísla la UI del schema de la BD.
//
// Si cambia una columna en la BD, solo se actualiza este archivo;
// los componentes y rutas que consumen EmployeeService no se tocan.

import type { EmployeeService, AssignmentStatus } from "@/types/dispatch";

/** Datos crudos de la BD (snake_case) necesarios para construir un EmployeeService. */
export interface EmployeeServiceMappingInput {
  assignment: {
    id: string;
    order_id: string;
    status: AssignmentStatus;
    assigned_at?: string;
    notes?: string | null;
  };
  order: {
    id: string;
    service_date: string;
    service_time: string;
    status?: string;
    quote_id?: string | null;
  };
  /** Quote asociada a la orden (puede ser null si la orden no tiene quote). */
  quote?: {
    service_type?: string | null;
    address?: string | null;
    zone?: string | null;
    square_feet?: number | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    pets_count?: number | null;
    pets_type?: string | null;
    residents?: number | null;
    total?: number | null;
  } | null;
  /** Nombre del cliente (desde profiles.full_name). */
  clientName?: string | null;
  /** Teléfono del cliente (desde profiles.phone). */
  clientPhone?: string | null;
  /** v8.3 E6.6: true si el cliente no tiene smartphone. */
  noSmartphoneFlow?: boolean;
}

/**
 * Convierte datos crudos de la BD (snake_case, 4 tablas) en un DTO
 * EmployeeService (camelCase) listo para consumir en la UI.
 *
 * Centraliza la transformación de columnas y el mapeo de service_type
 * a serviceSubtype (deep → first_time).
 */
export function mapToEmployeeService(
  input: EmployeeServiceMappingInput
): EmployeeService {
  const { assignment: a, order, quote, clientName, clientPhone, noSmartphoneFlow } = input;

  return {
    assignmentId: a.id,
    orderId: a.order_id,
    status: a.status,
    serviceDate: order.service_date,
    serviceTime: order.service_time,
    serviceSubtype:
      quote?.service_type === "deep" ? "first_time" : (quote?.service_type ?? ""),
    address: quote?.address ?? "",
    zone: quote?.zone ?? "",
    squareFeet: quote?.square_feet ?? 0,
    bedrooms: quote?.bedrooms ?? 0,
    bathrooms: quote?.bathrooms ?? 0,
    petsCount: quote?.pets_count ?? 0,
    petsType: quote?.pets_type ?? "",
    residents: quote?.residents ?? 0,
    notes: a.notes ?? undefined,
    clientName: clientName || "",
    clientPhone: clientPhone || "",
    noSmartphoneFlow,
  };
}
