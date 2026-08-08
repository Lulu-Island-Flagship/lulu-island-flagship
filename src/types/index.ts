// ─── Barrel de re-exportación de tipos ──────────────────────────
// Auditoría H1 (2026-08-06): el monolito de tipos de 692 líneas se dividió
// en archivos por dominio. Este archivo re-exporta todo para mantener
// compatibilidad con los imports existentes (`import { ... } from "@/types"`).
//
// Para imports nuevos, preferir el archivo de dominio directamente:
//   import { Employee } from "@/types/employee";
//   import { PayrollEntry } from "@/types/payroll";

// Cotizador (Módulo 0)
export type { QuoteInput, QuoteData, CotizadorStep, CotizadorState } from "./quote";

// Órdenes y Cliente (Módulo 0)
export type {
  OrderStatus,
  Order,
  ClientProfile,
  ClientProperty,
  ClientReview,
  ClientReviewScoreHistory,
  Zone,
  FeatureFlag,
  PricingRule,
  RuleAuditLog,
} from "./order";
export type { AppliedRule } from "./order";

// Empleado (Módulo 3)
export type {
  EmployeeRole,
  TrustLevel,
  Employee,
  EmployeeProfile,
} from "./employee";

// Flota / Vehículos
export type {
  Vehicle,
  VehicleTracking,
} from "./fleet";

// Despacho y Asignaciones
export type {
  SlotType,
  CapacitySlot,
  DispatchRunPhase,
  DispatchRun,
  NoShowStatus,
  NoShowLog,
  FieldAudit,
  AssignmentStatus,
  Assignment,
  EmployeeService,
} from "./dispatch";

// Ejecución de Servicio (Módulo 4)
export type {
  ServiceLogEvent,
  ServiceLog,
  SOPChecklistItem,
  SOPChecklist,
  ServiceChecklistItem,
  ServiceUpsell,
  ChecklistZoneProgress,
} from "./service-execution";

// Nómina (Módulo 2)
export type {
  PayrollEntry,
  PayrollSettings,
  EmployeePayrollConfig,
  EmployeeWithPayroll,
} from "./payroll";

// Facturación, Garantía, Contratos y Wallet (Módulo 2)
export type {
  WarrantyStatus,
  WarrantyClaim,
  WarrantyPhotoEvidence,
  ContractFrequency,
  ServiceContract,
  ContractInstance,
  QboExport,
  QboExportLine,
  ChargebackReserve,
  ChargebackSettings,
  ClientWallet,
  WalletTransaction,
} from "./billing";
