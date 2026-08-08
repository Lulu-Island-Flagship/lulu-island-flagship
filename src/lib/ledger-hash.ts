/**
 * Capa 0 — Ledger Row Hash (inmutabilidad criptográfica).
 *
 * Responsabilidad única: calcular el hash SHA-256 canónico de una fila
 * del Financial Ledger para garantizar integridad de auditoría. El hash
 * se computa concatenando los campos en orden fijo con separador `|`.
 *
 * Esta función es compartida entre financial-ledger (journal-entry.ts)
 * y payroll-engine.ts, y puede ser usada por cualquier módulo que
 * necesite verificar la integridad de filas del ledger.
 */

import { createHash } from "@/lib/crypto.server";

/**
 * Campos necesarios para calcular el hash de una fila (todos menos el hash mismo).
 */
export interface LedgerRowHashInput {
  event_id: string;
  event_type: string;
  timestamp: string;
  periodo_contable: string;
  cuenta_debito: string | null;
  cuenta_credito: string | null;
  monto: number;
  moneda: string;
  descripcion: string;
  referencia: Record<string, unknown>;
  estado: string;
  creado_por: string;
}

/**
 * Calcula SHA-256 hexadecimal del contenido canónico de una fila del ledger.
 * Los campos se concatenan en orden fijo con separador `|` para que el hash
 * sea determinístico y verificable.
 */
export function computeLedgerRowHash(row: LedgerRowHashInput): string {
  const canonical = [
    row.event_id,
    row.event_type,
    row.timestamp,
    row.periodo_contable,
    row.cuenta_debito ?? "",
    row.cuenta_credito ?? "",
    String(row.monto),
    row.moneda,
    row.descripcion,
    JSON.stringify(row.referencia),
    row.estado,
    row.creado_por,
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
