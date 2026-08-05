/**
 * v8.3 Capa 8 — Financial Reports: Reporting Engine.
 *
 * Generación de estados financieros a partir del `financial_ledger`.
 * Todas las funciones son puras: reciben arreglos de entradas ya leídas
 * desde la base de datos y devuelven estructuras tipadas. Nunca hacen
 * queries directos. Latencia objetivo: <200ms para datasets de hasta
 * 10,000 entradas en una sola llamada síncrona.
 *
 * Estados financieros:
 *   1. Trial Balance      — SUM por cuenta, validación SUM(debits) = SUM(credits)
 *   2. Profit & Loss      — Ingresos - Costos Directos - Gastos Operativos = Net Income
 *   3. Balance Sheet      — Activos = Pasivos + Patrimonio (snapshot a fecha de corte)
 *   4. Cash Flow          — Operaciones + Inversiones + Financiamiento
 *
 * Diferenciador: P&L por dimensiones (zona, equipo, tipo de servicio).
 * Esto es lo que QuickBooks Online NUNCA podrá darte con la granularidad
 * operativa que necesitas.
 *
 * Dependencias:
 *   - coa.ts: CuentaCOA, CHART_OF_ACCOUNTS, getCuentaByCodigo, AccountSubtype.
 *   - El caller lee financial_ledger (tabla futura) y pasa los registros aquí.
 */

import {
  getCuentaByCodigo,
  type AccountType,
} from "@/lib/coa";

// ---------------------------------------------------------------------------
// Financial Ledger — domain types
// ---------------------------------------------------------------------------

/** Fuente de una entrada del ledger (quién / qué sistema la generó). */
export type LedgerEntrySource =
  | "manual"
  | "stripe"
  | "paypal"
  | "payroll"
  | "system"
  | "reconciliation";

/** Dirección contable de una entrada. */
export type EntryDirection = "debit" | "credit";

/**
 * Una entrada individual del `financial_ledger`.
 * Representa una línea de diario contable — siempre referencia un código
 * de cuenta del COA (string de 4 dígitos), con monto positivo y dirección
 * explícita (nunca se usa el signo para inferir débito/crédito).
 */
export interface FinancialLedgerEntry {
  /** UUID de la entrada en la base de datos. */
  id: string;
  /** Código de cuenta del COA (e.g., "4010" = Service Revenue, "5010" = Labor). */
  accountCode: string;
  /** Monto en centavos CAD, siempre positivo. */
  amountCents: number;
  /** Dirección: débito (aumenta activos/gastos) o crédito (aumenta pasivos/ingresos/patrimonio). */
  direction: EntryDirection;
  /** Período contable en formato YYYY-MM. */
  period: string;
  /** Fecha exacta en que ocurrió la transacción (ISO 8601). */
  occurredAt: string;
  /** ID de la orden relacionada, si aplica. */
  orderId?: string;
  /** Zona geográfica (desnormalizada para reportes dimensionales rápidos). */
  zone?: string;
  /** Etiqueta del equipo que ejecutó el servicio. */
  team?: string;
  /** Tipo de servicio: regular, deep, move_in_out, post_construction. */
  serviceType?: string;
  /** Sistema o proceso que originó la entrada. */
  source: LedgerEntrySource;
  /** Descripción legible de la transacción. */
  description?: string;
  /** Metadatos adicionales (JSON). */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers: clasificación de cuentas por subtipo (coa.ts)
// ---------------------------------------------------------------------------

/** Devuelve true si la cuenta es de ingresos operativos. */
function isRevenue(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.subtipo === "INGRESO_OPERATIVO";
}

/** Devuelve true si la cuenta es contra-ingreso (descuentos/devoluciones). */
function isContraIngreso(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.subtipo === "CONTRA_INGRESO";
}

/** Devuelve true si la cuenta es de costo directo (COGS). */
function isCostoDirecto(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.subtipo === "COSTO_DIRECTO";
}

/** Devuelve true si la cuenta es de gasto operativo. */
function isGastoOperativo(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.subtipo === "GASTO_OPERATIVO";
}

/** Devuelve true si la cuenta es de otro ingreso. */
function isOtroIngreso(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.subtipo === "OTRO_INGRESO";
}

/** Devuelve true si la cuenta es de otro gasto. */
function isOtroGasto(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.subtipo === "OTRO_GASTO";
}

/** Devuelve true si la cuenta es impuesto a la renta. */
function isImpuestoRenta(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.subtipo === "IMPUESTO_RENTA";
}

/** Devuelve true si la cuenta es de activo. */
function isActivo(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.tipo === "ACTIVO";
}

/** Devuelve true si la cuenta es de pasivo. */
function isPasivo(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.tipo === "PASIVO";
}

/** Devuelve true si la cuenta es de patrimonio. */
function isPatrimonio(codigo: string): boolean {
  const c = getCuentaByCodigo(codigo);
  return c?.tipo === "PATRIMONIO";
}

/** Devuelve true si la cuenta pertenece al P&L (ingresos, contra-ingresos, costos, gastos). */
function isPnLAccount(codigo: string): boolean {
  return (
    isRevenue(codigo) ||
    isContraIngreso(codigo) ||
    isCostoDirecto(codigo) ||
    isGastoOperativo(codigo) ||
    isOtroIngreso(codigo) ||
    isOtroGasto(codigo) ||
    isImpuestoRenta(codigo)
  );
}

/** Devuelve true si la cuenta pertenece al Balance Sheet. */
function isBalanceSheetAccount(codigo: string): boolean {
  return isActivo(codigo) || isPasivo(codigo) || isPatrimonio(codigo);
}

// ---------------------------------------------------------------------------
// Trial Balance
// ---------------------------------------------------------------------------

/** Una línea del Trial Balance: saldo neto de una cuenta. */
export interface TrialBalanceLine {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  /** Saldo deudor (positivo para activos/gastos). */
  debitBalanceCents: number;
  /** Saldo acreedor (positivo para pasivos/ingresos/patrimonio). */
  creditBalanceCents: number;
}

/** Resultado completo del Trial Balance. */
export interface TrialBalance {
  period: string;
  lines: TrialBalanceLine[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  isBalanced: boolean;
  discrepancyCents: number;
}

/**
 * Genera un Trial Balance a partir de las entradas del ledger.
 *
 * Agrupa todas las entradas por accountCode, calcula el saldo neto
 * (débitos - créditos para cada cuenta) y lo presenta en la columna
 * que corresponde según el saldo normal de la cuenta.
 *
 * Validación: SUM(totalDebitsCents) DEBE ser igual a SUM(totalCreditsCents).
 * Si no lo es, `isBalanced` será false — esto indica un error en la
 * partida doble (entradas no balanceadas).
 *
 * @param entries Entradas del financial_ledger para el período.
 * @param period Período contable (YYYY-MM).
 */
export function generateTrialBalance(
  entries: FinancialLedgerEntry[],
  period: string
): TrialBalance {
  const byAccount = new Map<
    string,
    { totalDebitCents: number; totalCreditCents: number }
  >();

  for (const entry of entries) {
    if (entry.period !== period) continue;
    const agg = byAccount.get(entry.accountCode) ?? {
      totalDebitCents: 0,
      totalCreditCents: 0,
    };
    if (entry.direction === "debit") {
      agg.totalDebitCents += entry.amountCents;
    } else {
      agg.totalCreditCents += entry.amountCents;
    }
    byAccount.set(entry.accountCode, agg);
  }

  const lines: TrialBalanceLine[] = [];
  let totalDebitsCents = 0;
  let totalCreditsCents = 0;

  for (const [code, agg] of byAccount) {
    const cuenta = getCuentaByCodigo(code);
    const accountName = cuenta?.nombre ?? `Unknown (${code})`;
    const accountType: AccountType = cuenta?.tipo ?? "GASTO";

    const netCents = agg.totalDebitCents - agg.totalCreditCents;

    let debitBalanceCents = 0;
    let creditBalanceCents = 0;

    if (netCents > 0) {
      debitBalanceCents = netCents;
    } else if (netCents < 0) {
      creditBalanceCents = -netCents;
    }

    totalDebitsCents += debitBalanceCents;
    totalCreditsCents += creditBalanceCents;

    lines.push({
      accountCode: code,
      accountName,
      accountType,
      debitBalanceCents,
      creditBalanceCents,
    });
  }

  lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const discrepancyCents = Math.abs(totalDebitsCents - totalCreditsCents);

  return {
    period,
    lines,
    totalDebitsCents,
    totalCreditsCents,
    isBalanced: discrepancyCents === 0,
    discrepancyCents,
  };
}

// ---------------------------------------------------------------------------
// Profit & Loss (Estado de Resultados)
// ---------------------------------------------------------------------------

/** Línea individual del P&L con jerarquía de subtotales. */
export interface PnLLine {
  label: string;
  amountCents: number;
  indent: number;
  isSubtotal: boolean;
  accountCode?: string;
  children?: PnLLine[];
}

/** Estado de Resultados completo. */
export interface ProfitAndLoss {
  period: string;
  lines: PnLLine[];
  grossRevenueCents: number;
  discountsAndReturnsCents: number;
  netRevenueCents: number;
  totalDirectCostsCents: number;
  grossMarginCents: number;
  grossMarginPercent: number;
  totalOperatingExpensesCents: number;
  ebitdaCents: number;
  ebitdaPercent: number;
  depreciationCents: number;
  otherIncomeNetCents: number;
  incomeBeforeTaxCents: number;
  taxExpenseCents: number;
  netIncomeCents: number;
  netMarginPercent: number;
}

/**
 * Genera un Estado de Resultados (P&L) a partir de las entradas del ledger.
 *
 * Jerarquía:
 *   Ingresos Brutos → (-) Descuentos/Devoluciones → Ingresos Netos
 *   → (-) Costos Directos → Margen Bruto
 *   → (-) Gastos Operativos → EBITDA
 *   → (-) Depreciación + Otros → Utilidad Antes de Impuestos
 *   → (-) Impuesto → Utilidad Neta
 *
 * @param entries Entradas del financial_ledger para el período.
 * @param period Período contable (YYYY-MM).
 */
export function generatePnL(
  entries: FinancialLedgerEntry[],
  period: string
): ProfitAndLoss {
  const pnlEntries = entries.filter(
    (e) => e.period === period && isPnLAccount(e.accountCode)
  );

  // Agrupar por accountCode: créditos - débitos (ingresos son crédito, gastos son débito)
  const byAccount = new Map<string, number>();
  for (const entry of pnlEntries) {
    const prev = byAccount.get(entry.accountCode) ?? 0;
    const sign = entry.direction === "credit" ? 1 : -1;
    byAccount.set(entry.accountCode, prev + entry.amountCents * sign);
  }

  const getAmount = (code: string): number => byAccount.get(code) ?? 0;
  const sumRange = (codes: string[]): number =>
    codes.reduce((sum, c) => sum + getAmount(c), 0);

  // --- Ingresos ---
  const revenueCodes = ["4010", "4020", "4030", "4035", "4040", "4050", "4060"];
  const discountCodes = ["4100", "4105"];

  const totalServiceRevenue = getAmount("4010");
  const totalUpsell = getAmount("4020");
  const totalGiftCard = getAmount("4030") + getAmount("4035");
  const totalReferral = getAmount("4040");
  const totalCancellation = getAmount("4050");
  const totalRush = getAmount("4060");

  const grossRevenueCents = sumRange(revenueCodes);
  const discountsAndReturnsCents = Math.abs(sumRange(discountCodes));
  const netRevenueCents = grossRevenueCents - discountsAndReturnsCents;

  // --- Costos Directos ---
  const directCostCodes = ["5010", "5020", "5030", "5040", "5050", "5060", "5070", "5080", "5090", "5100"];
  const totalLabor = getAmount("5010");
  const totalPayrollTaxes = getAmount("5020");
  const totalSupplies = getAmount("5030");
  const totalEquipmentCost = getAmount("5040") + getAmount("5100");
  const totalFuel = getAmount("5050");
  const totalUniforms = getAmount("5060");
  const totalChemicals = getAmount("5070");
  const totalPPE = getAmount("5080");
  const totalVehicleMaint = getAmount("5090");

  const totalDirectCostsCents = sumRange(directCostCodes);

  // --- Margen Bruto ---
  const grossMarginCents = netRevenueCents - totalDirectCostsCents;
  const grossMarginPercent =
    netRevenueCents > 0 ? grossMarginCents / netRevenueCents : 0;

  // --- Gastos Operativos (60xx) ---
  const opexCodes = Array.from(
    { length: 15 },
    (_, i) => String(6010 + i * 10)
  ); // "6010"..."6150"
  const totalRent = getAmount("6010");
  const totalInsurance = getAmount("6020");
  const totalMarketing = getAmount("6030");
  const totalSoftware = getAmount("6040");
  const totalProfFees = getAmount("6050");
  const totalBankFees = getAmount("6060");
  const totalOfficeSupplies = getAmount("6070");
  const totalTelecom = getAmount("6080");
  const totalTravel = getAmount("6090");
  const totalTraining = getAmount("6100");
  const totalLicenses = getAmount("6110");
  const totalBadDebt = getAmount("6120");
  const totalUtilities = getAmount("6130");
  const totalRepairs = getAmount("6140");

  const totalOperatingExpensesCents = sumRange(opexCodes);

  // --- Depreciación (70xx, OTRO_GASTO) ---
  const depreciationCents = getAmount("7030");

  // --- EBITDA ---
  const ebitdaCents = grossMarginCents - totalOperatingExpensesCents;
  const ebitdaPercent = netRevenueCents > 0 ? ebitdaCents / netRevenueCents : 0;

  // --- Otros ingresos / gastos ---
  const interestIncome = getAmount("7010");
  const interestExpense = getAmount("7020");
  const assetDisposal = getAmount("7040");
  const fxGainLoss = getAmount("7050");
  const otherIncomeNetCents =
    interestIncome + interestExpense + assetDisposal + fxGainLoss;

  // --- Impuestos ---
  const taxExpenseCents = 0; // la tabla no tiene cuenta de impuesto; se deja en 0

  // --- Net Income ---
  const incomeBeforeTaxCents =
    ebitdaCents - depreciationCents + otherIncomeNetCents;
  const netIncomeCents = incomeBeforeTaxCents - taxExpenseCents;
  const netMarginPercent =
    netRevenueCents > 0 ? netIncomeCents / netRevenueCents : 0;

  // --- Construir líneas jerárquicas ---
  const lines: PnLLine[] = [];

  function line(
    label: string,
    amountCents: number,
    indent: number,
    isSubtotal: boolean,
    accountCode?: string
  ): PnLLine {
    return { label, amountCents, indent, isSubtotal, accountCode };
  }

  function subtotal(
    label: string,
    amountCents: number,
    indent: number,
    children: PnLLine[]
  ): PnLLine {
    return { label, amountCents, indent, isSubtotal: true, children };
  }

  // Ingresos
  lines.push(
    subtotal("Operating Revenue", grossRevenueCents, 0, [
      line("Service Revenue", totalServiceRevenue, 1, false, "4010"),
      line("Upsell / Add-on Revenue", totalUpsell, 1, false, "4020"),
      line("Gift Card Revenue", totalGiftCard, 1, false, "4030"),
      line("Referral Revenue", totalReferral, 1, false, "4040"),
      line("Cancellation Fees", totalCancellation, 1, false, "4050"),
      line("Rush Service Fees", totalRush, 1, false, "4060"),
    ])
  );
  lines.push(
    line("Less: Discounts & Returns", -discountsAndReturnsCents, 0, false)
  );
  lines.push(line("Net Revenue", netRevenueCents, 0, true));

  // Costos Directos
  lines.push(
    subtotal("Direct Costs", totalDirectCostsCents, 0, [
      line("Labor — Day Rate", totalLabor, 1, false, "5010"),
      line("Payroll Taxes — Employer", totalPayrollTaxes, 1, false, "5020"),
      line("Supplies", totalSupplies, 1, false, "5030"),
      line("Equipment (non-capital)", totalEquipmentCost, 1, false, "5040"),
      line("Fuel", totalFuel, 1, false, "5050"),
      line("Uniforms", totalUniforms, 1, false, "5060"),
      line("Chemical Supplies", totalChemicals, 1, false, "5070"),
      line("PPE & Safety", totalPPE, 1, false, "5080"),
      line("Vehicle Maintenance", totalVehicleMaint, 1, false, "5090"),
    ])
  );
  lines.push(line("Gross Margin", grossMarginCents, 0, true));

  // Gastos Operativos
  lines.push(
    subtotal("Operating Expenses", totalOperatingExpensesCents, 0, [
      line("Rent", totalRent, 1, false, "6010"),
      line("Insurance", totalInsurance, 1, false, "6020"),
      line("Marketing", totalMarketing, 1, false, "6030"),
      line("Software", totalSoftware, 1, false, "6040"),
      line("Professional Fees", totalProfFees, 1, false, "6050"),
      line("Bank Fees", totalBankFees, 1, false, "6060"),
      line("Office Supplies", totalOfficeSupplies, 1, false, "6070"),
      line("Telephone & Internet", totalTelecom, 1, false, "6080"),
      line("Travel & Meals", totalTravel, 1, false, "6090"),
      line("Training & Development", totalTraining, 1, false, "6100"),
      line("Licenses & Permits", totalLicenses, 1, false, "6110"),
      line("Bad Debt Expense", totalBadDebt, 1, false, "6120"),
      line("Utilities", totalUtilities, 1, false, "6130"),
      line("Repairs & Maintenance", totalRepairs, 1, false, "6140"),
    ])
  );
  lines.push(line("EBITDA", ebitdaCents, 0, true));

  // Depreciación y otros
  lines.push(
    line("Less: Depreciation", -depreciationCents, 0, false)
  );

  if (otherIncomeNetCents !== 0) {
    const otherChildren: PnLLine[] = [];
    if (interestIncome !== 0)
      otherChildren.push(line("Interest Income", interestIncome, 2, false, "7010"));
    if (interestExpense !== 0)
      otherChildren.push(line("Interest Expense", interestExpense, 2, false, "7020"));
    if (assetDisposal !== 0)
      otherChildren.push(line("Gain/Loss on Asset Disposal", assetDisposal, 2, false, "7040"));
    if (fxGainLoss !== 0)
      otherChildren.push(line("FX Gain/Loss", fxGainLoss, 2, false, "7050"));
    lines.push(subtotal("Other Income / Expense", otherIncomeNetCents, 0, otherChildren));
  }

  lines.push(line("Income Before Tax", incomeBeforeTaxCents, 0, true));
  lines.push(line("Net Income", netIncomeCents, 0, true));

  return {
    period,
    lines,
    grossRevenueCents,
    discountsAndReturnsCents,
    netRevenueCents,
    totalDirectCostsCents,
    grossMarginCents,
    grossMarginPercent,
    totalOperatingExpensesCents,
    ebitdaCents,
    ebitdaPercent,
    depreciationCents,
    otherIncomeNetCents,
    incomeBeforeTaxCents,
    taxExpenseCents,
    netIncomeCents,
    netMarginPercent,
  };
}

// ---------------------------------------------------------------------------
// Balance Sheet
// ---------------------------------------------------------------------------

export interface BalanceSheetSection {
  label: string;
  lines: PnLLine[];
  totalCents: number;
}

export interface BalanceSheet {
  asOfDate: string;
  currentAssets: BalanceSheetSection;
  fixedAssets: BalanceSheetSection;
  totalAssetsCents: number;
  currentLiabilities: BalanceSheetSection;
  longTermLiabilities: BalanceSheetSection;
  totalLiabilitiesCents: number;
  equity: BalanceSheetSection;
  totalEquityCents: number;
  isBalanced: boolean;
  discrepancyCents: number;
}

/**
 * Genera un Balance Sheet (snapshot a fecha de corte).
 *
 * Acumula todas las entradas de cuentas de balance (activos, pasivos,
 * patrimonio) desde el inicio hasta `asOfDate`.
 *
 * Validación: Activos = Pasivos + Patrimonio.
 *
 * @param entries Entradas del ledger (todas las fechas hasta asOfDate).
 * @param asOfDate Fecha de corte (YYYY-MM-DD).
 */
export function generateBalanceSheet(
  entries: FinancialLedgerEntry[],
  asOfDate: string
): BalanceSheet {
  const bsEntries = entries.filter(
    (e) => e.occurredAt <= asOfDate && isBalanceSheetAccount(e.accountCode)
  );

  const byAccount = new Map<string, number>();
  for (const entry of bsEntries) {
    const prev = byAccount.get(entry.accountCode) ?? 0;
    const sign = entry.direction === "debit" ? 1 : -1;
    byAccount.set(entry.accountCode, prev + entry.amountCents * sign);
  }

  const getAmount = (code: string): number => byAccount.get(code) ?? 0;

  function line(label: string, amountCents: number, indent: number, accountCode?: string): PnLLine {
    return { label, amountCents, indent, isSubtotal: false, accountCode };
  }

  // --- Current Assets (10xx) ---
  const totalCash = getAmount("1010") + getAmount("1015");
  const totalAR = getAmount("1020") + getAmount("1025");
  const totalInventory = getAmount("1030");
  const totalWIP = getAmount("1035");
  const totalPrepaid = getAmount("1040") + getAmount("1045");

  const currentAssetsTotal = totalCash + totalAR + totalInventory + totalWIP + totalPrepaid;

  const currentAssets: BalanceSheetSection = {
    label: "Current Assets",
    lines: [
      line("Cash & Petty Cash", totalCash, 1),
      line("Accounts Receivable (net)", totalAR, 1),
      line("Inventory", totalInventory, 1),
      line("Work-in-Progress", totalWIP, 1),
      line("Prepaid Expenses", totalPrepaid, 1),
      { label: "Total Current Assets", amountCents: currentAssetsTotal, indent: 0, isSubtotal: true },
    ],
    totalCents: currentAssetsTotal,
  };

  // --- Fixed Assets (11xx) ---
  const vehicles = getAmount("1105");
  const accumDepVehicles = getAmount("1106");
  const accumDep = getAmount("1110");
  const equipment = getAmount("1115");
  const accumDepEquip = getAmount("1116");
  const computers = getAmount("1120");
  const accumDepComputers = getAmount("1121");

  const fixedAssetsGross = vehicles + equipment + computers;
  const totalAccumDep = accumDepVehicles + accumDep + accumDepEquip + accumDepComputers;
  const fixedAssetsNet = fixedAssetsGross + totalAccumDep; // accum dep es crédito

  const fixedAssets: BalanceSheetSection = {
    label: "Fixed Assets",
    lines: [
      line("Vehicles", vehicles, 1),
      line("Equipment", equipment, 1),
      line("Computer Equipment", computers, 1),
      line("Less: Accumulated Depreciation", totalAccumDep, 1),
      { label: "Total Fixed Assets (net)", amountCents: fixedAssetsNet, indent: 0, isSubtotal: true },
    ],
    totalCents: fixedAssetsNet,
  };

  const totalAssetsCents = currentAssetsTotal + fixedAssetsNet;

  // --- Current Liabilities (20xx) ---
  const totalAP = getAmount("2010");
  const totalPayrollPayable = getAmount("2020");
  const totalGST = getAmount("2030");
  const totalPST = getAmount("2040");
  const totalTaxPayable = totalGST + totalPST;
  const totalUnearnedRev = getAmount("2050");

  const currentLiabilitiesTotal = totalAP + totalPayrollPayable + totalTaxPayable + totalUnearnedRev;

  const currentLiabilities: BalanceSheetSection = {
    label: "Current Liabilities",
    lines: [
      line("Accounts Payable", totalAP, 1),
      line("Payroll Payable", totalPayrollPayable, 1),
      line("Tax Payable (GST/PST)", totalTaxPayable, 1),
      line("Unearned Revenue", totalUnearnedRev, 1),
      { label: "Total Current Liabilities", amountCents: currentLiabilitiesTotal, indent: 0, isSubtotal: true },
    ],
    totalCents: currentLiabilitiesTotal,
  };

  // --- Long-Term Liabilities (30xx) ---
  const loans = getAmount("3010");
  const longTermTotal = loans;

  const longTermLiabilities: BalanceSheetSection = {
    label: "Long-Term Liabilities",
    lines: [
      line("Loans Payable", loans, 1),
      { label: "Total Long-Term Liabilities", amountCents: longTermTotal, indent: 0, isSubtotal: true },
    ],
    totalCents: longTermTotal,
  };

  const totalLiabilitiesCents = currentLiabilitiesTotal + longTermTotal;

  // --- Equity (30xx) ---
  const ownerEquity = getAmount("3010");
  const retainedEarnings = getAmount("3020");
  const ownerDraws = getAmount("3030");

  const totalEquityCents = ownerEquity + retainedEarnings + ownerDraws;

  const equity: BalanceSheetSection = {
    label: "Equity",
    lines: [
      line("Owner's Equity", ownerEquity, 1),
      line("Retained Earnings", retainedEarnings, 1),
      line("Owner's Draws", ownerDraws, 1),
      { label: "Total Equity", amountCents: totalEquityCents, indent: 0, isSubtotal: true },
    ],
    totalCents: totalEquityCents,
  };

  const discrepancyCents = Math.abs(
    totalAssetsCents - (totalLiabilitiesCents + totalEquityCents)
  );

  return {
    asOfDate,
    currentAssets,
    fixedAssets,
    totalAssetsCents,
    currentLiabilities,
    longTermLiabilities,
    totalLiabilitiesCents,
    equity,
    totalEquityCents,
    isBalanced: discrepancyCents === 0,
    discrepancyCents,
  };
}

// ---------------------------------------------------------------------------
// Cash Flow
// ---------------------------------------------------------------------------

export interface CashFlowSection {
  label: string;
  lines: PnLLine[];
  netCashCents: number;
}

export interface CashFlow {
  periodStart: string;
  periodEnd: string;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChangeInCashCents: number;
  beginningCashCents: number;
  endingCashCents: number;
}

/**
 * Genera un Cash Flow (método indirecto simplificado).
 *
 * Clasifica entradas en operaciones (P&L + cambios en working capital),
 * inversiones (activos fijos) y financiamiento (préstamos, capital).
 *
 * @param entries Entradas del ledger en el rango de fechas.
 * @param periodStart Inicio del período (YYYY-MM-DD).
 * @param periodEnd Fin del período (YYYY-MM-DD).
 * @param netIncomeCents Utilidad neta del P&L del mismo período.
 * @param depreciationCents Depreciación del período (no monetaria).
 * @param beginningCashCents Saldo de caja al inicio.
 */
export function generateCashFlow(
  entries: FinancialLedgerEntry[],
  periodStart: string,
  periodEnd: string,
  netIncomeCents: number,
  depreciationCents: number,
  beginningCashCents: number
): CashFlow {
  const rangeEntries = entries.filter(
    (e) => e.occurredAt >= periodStart && e.occurredAt <= periodEnd
  );

  const byAccount = new Map<string, number>();
  for (const entry of rangeEntries) {
    const prev = byAccount.get(entry.accountCode) ?? 0;
    const sign = entry.direction === "debit" ? 1 : -1;
    byAccount.set(entry.accountCode, prev + entry.amountCents * sign);
  }

  // --- Operating ---
  const arChange = -(byAccount.get("1020") ?? 0);
  const inventoryChange = -(byAccount.get("1030") ?? 0);
  const prepaidChange = -(byAccount.get("1040") ?? 0) - (byAccount.get("1045") ?? 0);
  const apChange = byAccount.get("2010") ?? 0;
  const payrollChange = byAccount.get("2020") ?? 0;
  const taxChange = (byAccount.get("2030") ?? 0) + (byAccount.get("2040") ?? 0);
  const unearnedChange = byAccount.get("2050") ?? 0;

  const workingCapitalChanges =
    arChange + inventoryChange + prepaidChange + apChange + payrollChange + taxChange + unearnedChange;

  const operatingNetCash = netIncomeCents + depreciationCents + workingCapitalChanges;

  const operatingLines: PnLLine[] = [
    { label: "Net Income", amountCents: netIncomeCents, indent: 0, isSubtotal: false },
    { label: "Add: Depreciation", amountCents: depreciationCents, indent: 1, isSubtotal: false },
  ];
  if (workingCapitalChanges !== 0) {
    operatingLines.push({
      label: "Changes in Working Capital",
      amountCents: workingCapitalChanges,
      indent: 1,
      isSubtotal: false,
    });
  }
  operatingLines.push({
    label: "Net Cash from Operations",
    amountCents: operatingNetCash,
    indent: 0,
    isSubtotal: true,
  });

  // --- Investing ---
  const vehiclePurchase = -(byAccount.get("1105") ?? 0);
  const equipPurchase = -(byAccount.get("1115") ?? 0);
  const computerPurchase = -(byAccount.get("1120") ?? 0);
  const investingNetCash = vehiclePurchase + equipPurchase + computerPurchase;

  const investingLines: PnLLine[] = [];
  if (vehiclePurchase !== 0)
    investingLines.push({ label: "Vehicle Purchase", amountCents: vehiclePurchase, indent: 1, isSubtotal: false });
  if (equipPurchase !== 0)
    investingLines.push({ label: "Equipment Purchase", amountCents: equipPurchase, indent: 1, isSubtotal: false });
  if (computerPurchase !== 0)
    investingLines.push({ label: "Computer Purchase", amountCents: computerPurchase, indent: 1, isSubtotal: false });
  investingLines.push({
    label: "Net Cash from Investing",
    amountCents: investingNetCash,
    indent: 0,
    isSubtotal: true,
  });

  // --- Financing ---
  const loanProceeds = byAccount.get("3010") ?? 0;
  const ownerCapital = byAccount.get("3010") ?? 0;
  const ownerDraws = byAccount.get("3030") ?? 0;
  const financingNetCash = loanProceeds + ownerCapital + ownerDraws;

  const financingLines: PnLLine[] = [];
  if (loanProceeds !== 0)
    financingLines.push({ label: "Loan Proceeds", amountCents: loanProceeds, indent: 1, isSubtotal: false });
  if (ownerCapital !== 0)
    financingLines.push({ label: "Owner Capital", amountCents: ownerCapital, indent: 1, isSubtotal: false });
  if (ownerDraws !== 0)
    financingLines.push({ label: "Owner Draws", amountCents: ownerDraws, indent: 1, isSubtotal: false });
  financingLines.push({
    label: "Net Cash from Financing",
    amountCents: financingNetCash,
    indent: 0,
    isSubtotal: true,
  });

  const netChangeInCashCents = operatingNetCash + investingNetCash + financingNetCash;

  return {
    periodStart,
    periodEnd,
    operating: { label: "Operating Activities", lines: operatingLines, netCashCents: operatingNetCash },
    investing: { label: "Investing Activities", lines: investingLines, netCashCents: investingNetCash },
    financing: { label: "Financing Activities", lines: financingLines, netCashCents: financingNetCash },
    netChangeInCashCents,
    beginningCashCents,
    endingCashCents: beginningCashCents + netChangeInCashCents,
  };
}

// ---------------------------------------------------------------------------
// P&L por Dimensiones (diferenciador vs. QBO)
// ---------------------------------------------------------------------------

export interface PnLByDimension {
  dimensionValue: string;
  orderCount: number;
  revenueCents: number;
  directCostsCents: number;
  grossMarginCents: number;
  grossMarginPercent: number;
}

/**
 * Genera P&L por zona geográfica.
 */
export function generatePnLByZone(
  entries: FinancialLedgerEntry[],
  period: string
): PnLByDimension[] {
  return generatePnLByDimension(entries, period, "zone");
}

/**
 * Genera P&L por equipo.
 */
export function generatePnLByTeam(
  entries: FinancialLedgerEntry[],
  period: string
): PnLByDimension[] {
  return generatePnLByDimension(entries, period, "team");
}

/**
 * Genera P&L por tipo de servicio.
 */
export function generatePnLByServiceType(
  entries: FinancialLedgerEntry[],
  period: string
): PnLByDimension[] {
  return generatePnLByDimension(entries, period, "serviceType");
}

function generatePnLByDimension(
  entries: FinancialLedgerEntry[],
  period: string,
  dimension: "zone" | "team" | "serviceType"
): PnLByDimension[] {
  const relevant = entries.filter(
    (e) =>
      e.period === period &&
      e[dimension] != null &&
      e[dimension] !== "" &&
      (isRevenue(e.accountCode) || isContraIngreso(e.accountCode) || isCostoDirecto(e.accountCode))
  );

  const groups = new Map<
    string,
    { revenueCents: number; directCostsCents: number; orderIds: Set<string> }
  >();

  for (const entry of relevant) {
    const key = entry[dimension]!;
    const group = groups.get(key) ?? {
      revenueCents: 0,
      directCostsCents: 0,
      orderIds: new Set(),
    };

    const sign = entry.direction === "credit" ? 1 : -1;
    const netAmount = entry.amountCents * sign;

    if (isRevenue(entry.accountCode) || isContraIngreso(entry.accountCode)) {
      group.revenueCents += netAmount;
    } else {
      group.directCostsCents += netAmount;
    }

    if (entry.orderId) {
      group.orderIds.add(entry.orderId);
    }

    groups.set(key, group);
  }

  const results: PnLByDimension[] = [];
  for (const [dimValue, group] of groups) {
    const grossMarginCents = group.revenueCents - group.directCostsCents;
    results.push({
      dimensionValue: dimValue,
      orderCount: group.orderIds.size,
      revenueCents: group.revenueCents,
      directCostsCents: group.directCostsCents,
      grossMarginCents,
      grossMarginPercent:
        group.revenueCents > 0 ? grossMarginCents / group.revenueCents : 0,
    });
  }

  results.sort((a, b) => b.grossMarginCents - a.grossMarginCents);
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// SQL: Vistas Materializadas para Reporting Engine
// ═══════════════════════════════════════════════════════════════════════════
//
// Las vistas abajo usan la tabla `financial_ledger` (a crearse en migración
// futura) y el COA existente en `coa_accounts` (o el catálogo en memoria).
//
// Estructura esperada de financial_ledger:
//
//   CREATE TABLE financial_ledger (
//     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     account_code  TEXT NOT NULL,     -- REFERENCES coa_accounts(codigo)
//     amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
//     direction     TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
//     period        TEXT NOT NULL,     -- 'YYYY-MM'
//     occurred_at   TIMESTAMPTZ NOT NULL,
//     order_id      UUID REFERENCES orders(id) ON DELETE SET NULL,
//     zone          TEXT,
//     team          TEXT,
//     service_type  TEXT,
//     source        TEXT NOT NULL,
//     description   TEXT,
//     metadata      JSONB DEFAULT '{}',
//     created_at    TIMESTAMPTZ DEFAULT now()
//   );
// ═══════════════════════════════════════════════════════════════════════════

/*
-- ============================================================
-- vw_trial_balance
-- SUM(amount_cents) agrupado por account_code, con validación de partida doble.
-- ============================================================
CREATE MATERIALIZED VIEW vw_trial_balance AS
WITH ledger_agg AS (
  SELECT
    account_code,
    SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE 0 END) AS total_debits,
    SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE 0 END) AS total_credits
  FROM financial_ledger
  WHERE period = current_period()
  GROUP BY account_code
),
balance AS (
  SELECT
    la.account_code,
    COALESCE(ca.nombre, 'Unknown (' || la.account_code || ')') AS account_name,
    COALESCE(ca.tipo, 'GASTO') AS account_type,
    la.total_debits - la.total_credits AS net_cents,
    CASE WHEN la.total_debits - la.total_credits > 0
         THEN la.total_debits - la.total_credits ELSE 0 END AS debit_balance,
    CASE WHEN la.total_debits - la.total_credits < 0
         THEN -(la.total_debits - la.total_credits) ELSE 0 END AS credit_balance
  FROM ledger_agg la
  LEFT JOIN coa_accounts ca ON ca.codigo = la.account_code
)
SELECT
  account_code,
  account_name,
  account_type,
  debit_balance,
  credit_balance,
  (SELECT SUM(debit_balance) - SUM(credit_balance) FROM balance) AS discrepancy_cents
FROM balance
ORDER BY account_code;
*/

/*
-- ============================================================
-- vw_estado_resultados (P&L)
-- Columnas: account_code, account_name, amount_cents, account_type, account_subtype.
-- ============================================================
CREATE MATERIALIZED VIEW vw_estado_resultados AS
WITH revenue AS (
  SELECT
    fl.account_code,
    ca.nombre AS account_name,
    ca.tipo AS account_type,
    ca.subtipo AS account_subtype,
    SUM(CASE WHEN fl.direction = 'credit' THEN fl.amount_cents
             ELSE -fl.amount_cents END) AS amount_cents
  FROM financial_ledger fl
  JOIN coa_accounts ca ON ca.codigo = fl.account_code
  WHERE fl.period = current_period()
    AND ca.subtipo IN ('INGRESO_OPERATIVO', 'CONTRA_INGRESO')
  GROUP BY fl.account_code, ca.nombre, ca.tipo, ca.subtipo
),
costs AS (
  SELECT
    fl.account_code,
    ca.nombre AS account_name,
    ca.tipo AS account_type,
    ca.subtipo AS account_subtype,
    SUM(CASE WHEN fl.direction = 'debit' THEN -fl.amount_cents
             ELSE fl.amount_cents END) AS amount_cents
  FROM financial_ledger fl
  JOIN coa_accounts ca ON ca.codigo = fl.account_code
  WHERE fl.period = current_period()
    AND ca.subtipo IN ('COSTO_DIRECTO', 'GASTO_OPERATIVO', 'OTRO_GASTO', 'OTRO_INGRESO', 'IMPUESTO_RENTA')
  GROUP BY fl.account_code, ca.nombre, ca.tipo, ca.subtipo
)
SELECT * FROM revenue
UNION ALL
SELECT * FROM costs
ORDER BY account_code;
*/

/*
-- ============================================================
-- vw_balance_sheet
-- Snapshot con columnas: account_code, account_name, account_type, amount_cents.
-- ============================================================
CREATE MATERIALIZED VIEW vw_balance_sheet AS
SELECT
  fl.account_code,
  ca.nombre AS account_name,
  ca.tipo AS account_type,
  ca.subtipo AS account_subtype,
  CASE
    WHEN ca.tipo = 'ACTIVO' THEN
      SUM(CASE WHEN fl.direction = 'debit' THEN fl.amount_cents
               ELSE -fl.amount_cents END)
    ELSE
      SUM(CASE WHEN fl.direction = 'credit' THEN fl.amount_cents
               ELSE -fl.amount_cents END)
  END AS amount_cents
FROM financial_ledger fl
JOIN coa_accounts ca ON ca.codigo = fl.account_code
WHERE fl.occurred_at <= CURRENT_DATE
  AND ca.tipo IN ('ACTIVO', 'PASIVO', 'PATRIMONIO')
GROUP BY fl.account_code, ca.nombre, ca.tipo, ca.subtipo
ORDER BY fl.account_code;

-- Validación: Activos = Pasivos + Patrimonio
-- SELECT
--   SUM(amount_cents) FILTER (WHERE account_type = 'ACTIVO') AS total_assets,
--   SUM(amount_cents) FILTER (WHERE account_type IN ('PASIVO','PATRIMONIO')) AS total_le
-- FROM vw_balance_sheet;
*/

/*
-- ============================================================
-- vw_cash_flow
-- Flujo de efectivo por categoría (operating, investing, financing).
-- ============================================================
CREATE MATERIALIZED VIEW vw_cash_flow AS
WITH categorized AS (
  SELECT
    fl.account_code,
    ca.nombre AS account_name,
    ca.subtipo AS account_subtype,
    CASE
      WHEN ca.subtipo IN ('INGRESO_OPERATIVO','CONTRA_INGRESO','COSTO_DIRECTO',
                          'GASTO_OPERATIVO','OTRO_INGRESO','OTRO_GASTO','IMPUESTO_RENTA')
        THEN 'operating'
      WHEN ca.subtipo IN ('ACTIVO_FIJO','DEPRECIACION_ACUMULADA')
        THEN 'investing'
      WHEN ca.tipo = 'PATRIMONIO'
           OR (ca.tipo = 'PASIVO' AND ca.subtipo = 'PASIVO_ACUMULADO')
        THEN 'financing'
      ELSE 'operating'
    END AS cash_flow_category,
    CASE
      WHEN ca.tipo = 'ACTIVO' AND fl.direction = 'debit'
        THEN -fl.amount_cents
      WHEN ca.tipo = 'ACTIVO' AND fl.direction = 'credit'
        THEN fl.amount_cents
      WHEN ca.tipo IN ('PASIVO','PATRIMONIO','INGRESO') AND fl.direction = 'credit'
        THEN fl.amount_cents
      WHEN ca.tipo IN ('PASIVO','PATRIMONIO','INGRESO') AND fl.direction = 'debit'
        THEN -fl.amount_cents
      WHEN ca.tipo = 'GASTO' AND fl.direction = 'debit'
        THEN -fl.amount_cents
      WHEN ca.tipo = 'GASTO' AND fl.direction = 'credit'
        THEN fl.amount_cents
      ELSE CASE WHEN fl.direction = 'debit' THEN -fl.amount_cents ELSE fl.amount_cents END
    END AS cash_effect_cents
  FROM financial_ledger fl
  JOIN coa_accounts ca ON ca.codigo = fl.account_code
  WHERE fl.occurred_at BETWEEN period_start() AND period_end()
)
SELECT
  cash_flow_category,
  account_code,
  account_name,
  SUM(cash_effect_cents) AS net_change_cents
FROM categorized
GROUP BY cash_flow_category, account_code, account_name
ORDER BY cash_flow_category, account_code;
*/

/*
-- ============================================================
-- vw_pnl_by_dimension
-- Margen bruto por zona, equipo o tipo de servicio.
-- ============================================================
CREATE MATERIALIZED VIEW vw_pnl_by_zone AS
SELECT
  fl.zone AS dimension_value,
  COUNT(DISTINCT fl.order_id) AS order_count,
  SUM(CASE WHEN ca.subtipo = 'INGRESO_OPERATIVO'
           THEN CASE WHEN fl.direction = 'credit' THEN fl.amount_cents ELSE -fl.amount_cents END
           ELSE 0 END)
    + SUM(CASE WHEN ca.subtipo = 'CONTRA_INGRESO'
               THEN CASE WHEN fl.direction = 'credit' THEN fl.amount_cents ELSE -fl.amount_cents END
               ELSE 0 END) AS revenue_cents,
  SUM(CASE WHEN ca.subtipo = 'COSTO_DIRECTO'
           THEN CASE WHEN fl.direction = 'debit' THEN fl.amount_cents ELSE -fl.amount_cents END
           ELSE 0 END) AS direct_costs_cents
FROM financial_ledger fl
JOIN coa_accounts ca ON ca.codigo = fl.account_code
WHERE fl.period = current_period()
  AND fl.zone IS NOT NULL AND fl.zone <> ''
  AND ca.subtipo IN ('INGRESO_OPERATIVO', 'CONTRA_INGRESO', 'COSTO_DIRECTO')
GROUP BY fl.zone
ORDER BY revenue_cents - direct_costs_cents DESC;

-- vw_pnl_by_team: reemplazar fl.zone por fl.team
-- vw_pnl_by_service_type: reemplazar fl.zone por fl.service_type
*/
