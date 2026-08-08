// ─── Tipos: Flota y Vehículos ──────────────────────────────────
// Extraído de src/types/employee.ts — auditoría H1 (2026-08-06).

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
