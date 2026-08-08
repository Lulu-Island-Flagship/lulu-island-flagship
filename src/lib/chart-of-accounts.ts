/**
 * Capa 0 — Chart of Accounts (Plan de Cuentas canónico).
 *
 * Responsabilidad única: definir el catálogo central de cuentas contables
 * usado por el Financial Ledger (partida doble). Este módulo NO contiene
 * lógica de negocio ni validación — solo las constantes de código de cuenta
 * y el tipo `CuentaContable`.
 *
 * Los códigos siguen la convención:
 *   Activos (1xxx), Pasivos (2xxx), Ingresos (4xxx), Contra-Ingresos (5xxx).
 */

// Fix (auditoría 2026-08-07, P0): códigos unificados con coa.ts (4 dígitos sin guiones).
// Anteriormente usaba formato "X-YYYY" (ej. "2-2020") que no coincidía con los
// códigos emitidos por coa-imputation.ts ("2020"), causando que tax-engine.ts
// calculara $0 de GST/PST.  Ahora todos los códigos usan el formato canónico de
// coa.ts: 4 dígitos numéricos sin separadores.
export const CHART_OF_ACCOUNTS = {
  /** Efectivo y Equivalentes (coa 1010) — cuentas bancarias operativas */
  EFECTIVO: "1010",
  /** Cuentas por Cobrar — Clientes (coa 1100) — facturas emitidas pendientes de cobro */
  CUENTAS_POR_COBRAR: "1100",
  /** Fondos Retenidos (coa 1130) — holds/autorizaciones Stripe/PayPal aún no capturados */
  FONDOS_RETENIDOS: "1130",
  /** Ingresos por Servicios (coa 4010) — revenue operativo por servicios prestados */
  INGRESOS_SERVICIOS: "4010",
  /** Ingresos por Penalidades de Cancelación (coa 4040) */
  INGRESOS_PENALIDADES: "4040",
  /** Reembolsos Emitidos (coa 4050) — contra-ingreso por devoluciones al cliente */
  REEMBOLSOS_EMITIDOS: "4050",
  /** Depósitos de Clientes — Contingente (coa 2010) — pasivo mientras el hold no se captura */
  DEPOSITOS_CONTINGENTES: "2010",
  // ── Capas 5 & 7: Tax Engine, AR B2B, Bank Reconciliation ──────────
  /** Cuentas por Cobrar B2B (coa 1020) — facturas B2B emitidas pendientes de cobro */
  CUENTAS_POR_COBRAR_AR: "1020",
  /** GST Input Tax Credits Receivable (coa 2025) — GST pagado en compras/gastos, compensable */
  GST_ITC_RECEIVABLE: "2025",
  /** GST Payable (coa 2020) — GST/HST 5% cobrado a clientes pendiente de remitir a CRA */
  GST_PAYABLE: "2020",
  /** PST Payable (coa 2030) — PST provincial BC 7% cobrado a clientes pendiente de remitir */
  PST_PAYABLE: "2030",
  /** Ingresos por Servicios Operativos (coa 4010) — alias semántico, mismo código */
  INGRESOS_SERVICIOS_4010: "4010",
  /** Nómina por Pagar (coa 2080) — sueldos devengados pendientes de pago */
  NOMINA: "2080",
} as const;

export type CuentaContable = (typeof CHART_OF_ACCOUNTS)[keyof typeof CHART_OF_ACCOUNTS];

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTA: La migración SQL de la tabla `financial_ledger` (CREATE TABLE +
 * trigger `trg_validate_double_entry`) que originalmente residía como
 * comentario en financial-ledger.ts DEBE moverse a un archivo de migración
 * real gestionado por Supabase CLI (p. ej. supabase/migrations/).
 *
 * Este documento NO contiene SQL ejecutable; es solo una referencia de las
 * cuentas contables canónicas del sistema.
 * ═══════════════════════════════════════════════════════════════════════════
 */
