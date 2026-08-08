/**
 * v9.0 Capa 0 — Financial Ledger (Partida Doble).
 *
 * Barrel module — re-exporta todo desde los módulos de responsabilidad única:
 *  - chart-of-accounts.ts  → Plan de Cuentas canónico
 *  - ledger-types.ts       → Tipos de dominio + Zod schemas
 *  - ledger-hash.ts        → Hash SHA-256 para inmutabilidad
 *  - journal-entry.ts      → Generador de asientos contables
 *  - order-balance-replay.ts → Reconstrucción de saldo por orden
 *
 * Este archivo existe para mantener compatibilidad hacia atrás con los
 * callers existentes. Si importás solo una o dos cosas, preferí importar
 * directamente del módulo específico.
 */

// ── Chart of Accounts ─────────────────────────────────────────────────
export { CHART_OF_ACCOUNTS, type CuentaContable } from "./chart-of-accounts";

// ── Ledger Domain Types & Schemas ─────────────────────────────────────
export {
  type BusinessEventType,
  type PaymentProcessor,
  type BusinessEvent,
  type LedgerEntryStatus,
  type JournalEntryRow,
  BusinessEventSchema,
  JournalEntryRowSchema,
} from "./ledger-types";

// ── Row Hash ──────────────────────────────────────────────────────────
export { computeLedgerRowHash, type LedgerRowHashInput } from "./ledger-hash";

// Alias para retrocompatibilidad con payroll-engine/payroll-journal
// (que esperan computeRowHash y HashableRow — mismos tipos, nombres legacy)
import { computeLedgerRowHash, type LedgerRowHashInput } from "./ledger-hash";
export const computeRowHash = computeLedgerRowHash;
export type HashableRow = LedgerRowHashInput;

// ── Journal Entry Generator ───────────────────────────────────────────
export { generateJournalEntry } from "./journal-entry";

// ── Order Balance Replay ──────────────────────────────────────────────
export {
  replayOrderBalance,
  type FinancialLedgerEntryForReplay,
  type ReplayedOrderBalance,
} from "./order-balance-replay";
