// ─── Tipos: Empleado y Operaciones (Módulos 3 y 4) ────────────
// Extraídos de src/types/index.ts — auditoría H1 (2026-08-06).

export type EmployeeRole = "cleaner" | "supervisor" | "driver";
export type TrustLevel = "elite" | "standard" | "probation";

// ─── Employee (fila DB completa) ──────────────────────────────

export interface Employee {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  role: EmployeeRole;
  /** v8.3 H3 (auditoría 2026-08-06): dayRate en DÓLARES (INTEGER).
   *  Para cálculos de nómina, convertir a centavos: dayRateCents = dayRate * 100.
   *  Ver src/lib/payroll-persist.ts para la convención completa. */
  dayRate: number;
  languages: string[];      // ej. ["en", "zh"]
  isActive: boolean;
  baseScheduleMinutes: number; // horario base (modelo 70/30)
  contingencyMinutes: number;  // contingencia (modelo 70/30)
  homeZone?: string;
  trustLevel: TrustLevel;
  vehicleId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── EmployeeProfile (vista de UI, sin datos de nómina) ────────
// Para enviar al frontend sin exponer dayRate, schedule, etc.
// Usar en DTOs de API que no necesitan información financiera.

export interface EmployeeProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: EmployeeRole;
  languages: string[];
  isActive: boolean;
  trustLevel: TrustLevel;
  homeZone?: string;
  vehicleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  name: string;
  plate?: string;
  isActive: boolean;
  currentLat?: number;
  currentLng?: number;
  lastLocationAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleTracking {
  id: string;
  vehicleId: string;
  lat: number;
  lng: number;
  recordedAt: string;
  source: "driver_app" | "gps_device" | "manual";
  metadata: Record<string, unknown>;
}

export type SlotType = "blocked" | "flexible" | "contingency";

export interface CapacitySlot {
  id: string;
  serviceDate: string;
  startTime: string;
  endTime: string;
  zone?: string;
  slotType: SlotType;
  maxTeams: number;
  committedTeams: number;
  blockedReason?: string;
  isPublished: boolean;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type DispatchRunPhase = "proposal" | "cutoff" | "published" | "simulation" | "crisis_fallback";

export interface DispatchRun {
  id: string;
  runDate: string;
  phase: DispatchRunPhase;
  triggeredAt: string;
  completedAt?: string;
  autoApproved: boolean;
  teamsAvailable: number;
  ordersProcessed: number;
  ordersAssigned: number;
  notes?: string;
  createdAt: string;
}

export type NoShowStatus = "waiting" | "recovered" | "unrecovered" | "cancelled";

export interface NoShowLog {
  id: string;
  orderId: string;
  employeeId?: string;
  detectedAt: string;
  graceUntil: string;
  recoveredAt?: string;
  recoveryAssignmentId?: string;
  clientNotifiedAt?: string;
  status: NoShowStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FieldAudit {
  id: string;
  orderId: string;
  employeeId: string;
  auditorId: string;
  score: number;
  criteria: Record<string, unknown>;
  notes?: string;
  photoUrl?: string;
  dispatchProbability: number;
  clientAnnounced: boolean;
  clientAnnouncedAt?: string;
  createdAt: string;
  appealedAt?: string;
  appealReason?: string;
  appealResolvedAt?: string;
}

export type AssignmentStatus =
  | "pending"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Assignment {
  id: string;
  orderId: string;
  employeeId: string;
  assignedAt: string;
  status: AssignmentStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

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

// Vista combinada para el empleado (assignment + order + quote)
export interface EmployeeService {
  assignmentId: string;
  orderId: string;
  status: AssignmentStatus;
  serviceDate: string;
  serviceTime: string;
  address: string;
  zone: string;
  serviceSubtype: string;
  squareFeet: number;
  bedrooms: number;
  bathrooms: number;
  petsCount: number;
  petsType: string;
  residents: number;
  notes?: string;
  clientName?: string;
  clientPhone?: string;
  addressLat?: number;
  addressLng?: number;
  /** v8.3 E6.6: cliente sin smartphone -- habilita pago alternativo con recibo firmado en el cierre. */
  noSmartphoneFlow?: boolean;
}

// ─── Módulo 4: Ejecución Física ─────────────────────────────

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
