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

// Empleado y Operaciones (Módulos 3 y 4)
export type {
  EmployeeRole,
  TrustLevel,
  Employee,
  Vehicle,
  VehicleTracking,
  SlotType,
  CapacitySlot,
  DispatchRunPhase,
  DispatchRun,
  NoShowStatus,
  NoShowLog,
  FieldAudit,
  AssignmentStatus,
  Assignment,
  ServiceLogEvent,
  ServiceLog,
  EmployeeService,
  SOPChecklistItem,
  SOPChecklist,
  ServiceChecklistItem,
  ServiceUpsell,
  ChecklistZoneProgress,
} from "./employee";

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
