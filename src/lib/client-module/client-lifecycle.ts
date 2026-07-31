import type { ClientStatus } from "./types";

// Módulo nuevo y separado: "Módulo de Cliente". Máquina de estados pura de
// `clients.status`. No hace I/O -- se puede testear unitariamente sin
// Supabase.

// Transiciones permitidas explícitas. `churned` es terminal (array vacío):
// una vez perdido, un cliente no vuelve a ningún otro estado directamente
// -- si se quisiera recuperar, sería un cliente/lead nuevo, no una
// transición sobre el mismo registro.
export const CLIENT_STATUS_TRANSITIONS: Record<ClientStatus, ClientStatus[]> = {
  lead: ["onboarding", "churned"],
  onboarding: ["active", "churned"],
  active: ["suspended", "inactive", "churned"],
  suspended: ["active", "churned"],
  inactive: ["active", "churned"],
  churned: [],
};

export function canTransition(from: ClientStatus, to: ClientStatus): boolean {
  const allowed = CLIENT_STATUS_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export class InvalidStatusTransitionError extends Error {
  readonly from: ClientStatus;
  readonly to: ClientStatus;

  constructor(from: ClientStatus, to: ClientStatus) {
    super(`Invalid client status transition: "${from}" -> "${to}"`);
    this.name = "InvalidStatusTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function assertValidTransition(from: ClientStatus, to: ClientStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}
