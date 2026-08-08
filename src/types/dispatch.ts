// ─── Tipos: Despacho y Asignaciones ────────────────────────────
// Extraído de src/types/employee.ts — auditoría H1 (2026-08-06).

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
