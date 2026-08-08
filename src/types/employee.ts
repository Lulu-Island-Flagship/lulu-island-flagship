// ─── Tipos: Empleado (Módulo 3) ────────────────────────────────
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
