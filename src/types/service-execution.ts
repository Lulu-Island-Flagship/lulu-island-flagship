// ─── Tipos: Ejecución de Servicio (Módulo 4) ──────────────────
// Extraído de src/types/employee.ts — auditoría H1 (2026-08-06).

export type ServiceLogEvent =
  | "jornada_start"
  | "jornada_end"
  | "t_in"           // Llegada al sitio
  | "t_start"        // Inicio de limpieza
  | "t_out"          // Finalización
  | "photo"          // Foto subida
  | "note";          // Nota del empleado

export interface ServiceLog {
  id: string;
  orderId: string;
  employeeId: string;
  eventType: ServiceLogEvent;
  timestamp: string;
  locationLat?: number;
  locationLng?: number;
  photoUrl?: string;
  notes?: string;
  createdAt: string;
}

export interface SOPChecklistItem {
  id: string;
  label: string;
  required: boolean;
}

export interface SOPChecklist {
  id: string;
  serviceSubtype: string;
  zone: string;
  zoneLabel: string;
  zoneColor: string;
  zoneIcon: string;
  items: SOPChecklistItem[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceChecklistItem {
  id: string;
  orderId: string;
  employeeId: string;
  checklistId: string;
  itemId: string;
  itemLabel: string;
  isCompleted: boolean;
  completedAt?: string;
  photoUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceUpsell {
  id: string;
  orderId: string;
  employeeId: string;
  upsellType: string;
  upsellLabel: string;
  amount: number;
  clientApproved?: boolean;
  notes?: string;
  createdAt: string;
}

export interface ChecklistZoneProgress {
  checklistId: string;  // UUID de sop_checklists
  zone: string;
  zoneLabel: string;
  zoneColor: string;
  zoneIcon: string;
  totalItems: number;
  completedItems: number;
  requiredItems: number;
  requiredCompleted: number;
  items: {
    itemId: string;
    label: string;
    required: boolean;
    isCompleted: boolean;
    photoUrl?: string;
    notes?: string;
    /** v8.3 E4 (D.7): true en ítems de estufa/campana — sujetos al timer de superficie caliente. */
    hotSurface?: boolean;
    /** ISO timestamp de cuándo el empleado inició el timer de 10 min; null/undefined = no iniciado. */
    hotSurfaceTimerStartedAt?: string | null;
  }[];
}
