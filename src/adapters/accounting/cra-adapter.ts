/**
 * Capa 9 — CRA (Canada Revenue Agency) Accounting Adapter.
 *
 * Adaptador de exportación para formatos requeridos por la CRA (equivalente
 * canadiense al IRS/SAT). Este archivo define la estructura y documenta los
 * formatos esperados. La implementación real de NETFILE y T4 XML se programa
 * para Año 2 (2027), cuando el volumen de transacciones y la complejidad
 * fiscal lo justifiquen.
 *
 * Formatos soportados (estructura base, placeholder Year 2):
 *   1. GST/HST NETFILE   — Declaración de impuestos GST/HST en formato XML.
 *   2. T4 XML            — Comprobantes de remuneración (T4 slips) en XML.
 *
 * Estado actual: PLACEHOLDER — documentación completa de schemas y campos,
 * funciones devuelven templates XML vacíos con valores de ejemplo comentados.
 * Listo para implementar cuando se integre con CRA NETFILE API.
 *
 * Referencias oficiales CRA:
 *   - GST/HST NETFILE: https://www.canada.ca/en/revenue-agency/services/e-services/e-services-businesses/gst-hst-netfile.html
 *   - T4 Internet File Transfer: https://www.canada.ca/en/revenue-agency/services/e-services/e-services-businesses/t4-internet-file-transfer.html
 *   - XML Schema specs disponibles en el portal "Represent a Client" de CRA.
 *
 * Regla de oro: Solo export. Nunca lee de CRA.
 */

import type { FinancialLedgerEntry } from "@/lib/financial-reports";
import type {
  AccountingAdapter,
  AccountingAdapterFactory,
} from "@/lib/accounting-adapter";

// ---------------------------------------------------------------------------
// GST/HST NETFILE — Placeholder (Year 2)
// ---------------------------------------------------------------------------

/**
 * Estructura de datos para una declaración GST/HST.
 *
 * Campos requeridos por CRA NETFILE para el GST/HST Return (Form GST34).
 * Los períodos de reporte pueden ser: mensual, trimestral, o anual según
 * el volumen de ingresos del negocio.
 *
 * Schema CRA NETFILE (resumen):
 *   <GSTHSTReturn>
 *     <BusinessNumber>123456789RT0001</BusinessNumber>    <!-- BN + programa -->
 *     <ReportingPeriod>2026-08-01/2026-08-31</ReportingPeriod>
 *     <TotalSales>5000000</TotalSales>                    <!-- Línea 101, centavos -->
 *     <GSTCollected>250000</GSTCollected>                 <!-- Línea 103, 5% GST -->
 *     <ITCs>125000</ITCs>                                 <!-- Línea 106, Input Tax Credits -->
 *     <Adjustments>0</Adjustments>                        <!-- Línea 107–108 -->
 *     <NetTax>125000</NetTax>                             <!-- Línea 109, GST collected - ITCs -->
 *     <InstallmentPayments>100000</InstallmentPayments>   <!-- Línea 110 -->
 *     <BalanceDue>25000</BalanceDue>                      <!-- Línea 113D o 115A (refund) -->
 *   </GSTHSTReturn>
 *
 * @see https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/gst34-2.html
 */
export interface GstReturnData {
  /** Business Number de 15 caracteres (9 dígitos + RT0001 para GST). */
  businessNumber: string;
  /** Período de reporte en formato YYYY-MM-DD/YYYY-MM-DD. */
  reportingPeriod: string;
  /** Ventas totales del período en centavos CAD (Línea 101). */
  totalSalesCents: number;
  /** GST/HST recolectado sobre ventas gravables en centavos (Línea 103/105). */
  gstCollectedCents: number;
  /** Input Tax Credits (ITCs) — GST pagado en compras de negocio, centavos (Línea 106/108). */
  inputTaxCreditsCents: number;
  /** Ajustes (líneas 107-108): bad debt, provincial credits, etc. */
  adjustmentsCents: number;
  /** Pagos a cuenta ya realizados en el período (Línea 110). */
  installmentPaymentsCents: number;
}

/**
 * Genera un template XML de GST/HST NETFILE para la CRA.
 *
 * PLACEHOLDER — Año 2. Esta función devuelve un XML estructuralmente
 * correcto pero SIN VALORES REALES (todo en ceros). La implementación
 * real en Año 2 reemplazará los placeholders con datos calculados a
 * partir del `financial_ledger` y las cuentas de impuestos del COA
 * (2040 GST Payable, 2050 PST Payable).
 *
 * Cuentas del COA relevantes para GST:
 *   - 2040 GST/HST Payable (pasivo corriente): GST recolectado pendiente de remitir.
 *   - 1030–1090 (gastos): contienen GST pagado elegible como ITC.
 *
 * @param periodo Período contable en formato YYYY-MM.
 * @returns String XML con estructura NETFILE y valores en cero.
 */
export function exportGstReturn(periodo: string): string {
  const [year, month] = periodo.split("-");
  const monthNum = parseInt(month, 10);
  const lastDay = new Date(parseInt(year, 10), monthNum, 0).getDate();
  const periodStart = `${year}-${month}-01`;
  const periodEnd = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;

  // Placeholder: en Año 2 se calcularán desde financial_ledger + COA
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  GST/HST NETFILE Return — Lulu Island Flagship
  Generated: ${new Date().toISOString().slice(0, 10)}
  Status: PLACEHOLDER (Year 2)

  TODO (Year 2):
  - Calcular totalSalesCents desde cuentas 4010–4060 del ledger.
  - Calcular gstCollectedCents (5% sobre ventas gravables, cuenta 2040).
  - Calcular inputTaxCreditsCents desde GST en cuentas de gasto 60xx.
  - Conectar con CRA NETFILE API para transmisión directa.
  - Validar contra schema XML oficial de CRA.
  - Agregar firma digital (CRA requiere PKI certificate).

  CRA NETFILE endpoint (sandbox):
    https://www.cra-arc.gc.ca/tx/bsnss/tpcs/gst-tps/bspsbch/menu-eng.html
  CRA Production endpoint requiere credenciales de "My Business Account".
-->
<GSTHSTReturn
  xmlns="http://www.cra-arc.gc.ca/GSTHST/2024"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <BusinessNumber>000000000RT0001</BusinessNumber><!-- TODO: BN real -->
  <ReportingPeriod>${periodStart}/${periodEnd}</ReportingPeriod>
  <FilingType>ORIGINAL</FilingType><!-- ORIGINAL | AMENDED -->
  <Currency>CAD</Currency>

  <!-- Section A: GST/HST collected -->
  <Line101>0</Line101><!-- Total sales (cents) -->
  <Line103>0</Line103><!-- GST collected (5%) -->
  <Line105>0</Line105><!-- Total GST/HST collected or collectible -->

  <!-- Section B: Input Tax Credits -->
  <Line106>0</Line106><!-- ITCs — GST paid on business purchases -->
  <Line108>0</Line108><!-- Total ITCs and adjustments -->

  <!-- Section C: Net Tax Calculation -->
  <Line109>0</Line109><!-- Net tax (Line 105 − Line 108) -->

  <!-- Section D: Other Credits -->
  <Line110>0</Line110><!-- Installment payments -->
  <Line111>0</Line111><!-- Rebates -->
  <Line112>0</Line112><!-- Total other credits -->

  <!-- Section E: Balance Due or Refund -->
  <Line113A>0</Line113A><!-- Balance due (if Line 109 > Line 112) -->
  <Line115A>0</Line115A><!-- Refund claimed (if Line 112 > Line 109) -->

  <!-- Preparer information -->
  <PreparerName>Lulu Island Flagship — Financial Core v9</PreparerName>
  <PreparerPhone></PreparerPhone>
</GSTHSTReturn>
`;
}

// ---------------------------------------------------------------------------
// T4 XML — Placeholder (Year 2)
// ---------------------------------------------------------------------------

/**
 * Datos de un comprobante T4 individual (Statement of Remuneration Paid).
 *
 * Schema CRA T4 XML (resumen simplificado — el schema real tiene ~80 campos):
 *   <T4Slip>
 *     <EmployeeSIN>123456789</EmployeeSIN>
 *     <EmployeeName>
 *       <LastName>Smith</LastName>
 *       <FirstName>John</FirstName>
 *     </EmployeeName>
 *     <EmployerBN>123456789RP0001</EmployerBN>
 *     <TaxYear>2026</TaxYear>
 *     <Box14>4500000</Box14>      <!-- Employment Income (cents)  -->
 *     <Box16>225000</Box16>       <!-- Employee CPP contributions  -->
 *     <Box18>72000</Box18>        <!-- Employee EI premiums       -->
 *     <Box22>675000</Box22>       <!-- Income Tax Deducted        -->
 *     <Box24>4500000</Box24>      <!-- EI Insurable Earnings      -->
 *     <Box26>4500000</Box26>      <!-- CPP Pensionable Earnings   -->
 *     <Box28></Box28>             <!-- Exempt CPP/EI (codes)      -->
 *     <Box29></Box29>             <!-- Employment Code            -->
 *     <Box44></Box44>             <!-- Union Dues                 -->
 *     <Box46></Box46>             <!-- Charitable Donations       -->
 *   </T4Slip>
 *
 * @see https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/t4.html
 * @see https://www.canada.ca/en/revenue-agency/services/e-services/e-services-businesses/t4-internet-file-transfer.html
 */
export interface T4SlipData {
  /** Social Insurance Number del empleado (9 dígitos). */
  employeeSIN: string;
  /** Apellido del empleado. */
  lastName: string;
  /** Nombre del empleado. */
  firstName: string;
  /** Año fiscal (ej. 2026). */
  taxYear: number;
  /** Employment Income — Box 14, en centavos. */
  employmentIncomeCents: number;
  /** Employee CPP Contributions — Box 16, en centavos. */
  cppContributionsCents: number;
  /** Employee EI Premiums — Box 18, en centavos. */
  eiPremiumsCents: number;
  /** Income Tax Deducted — Box 22, en centavos. */
  incomeTaxDeductedCents: number;
  /** EI Insurable Earnings — Box 24, en centavos. */
  eiInsurableEarningsCents: number;
  /** CPP Pensionable Earnings — Box 26, en centavos. */
  cppPensionableEarningsCents: number;
}

/**
 * Genera un template XML de T4 slip para la CRA.
 *
 * PLACEHOLDER — Año 2. Devuelve un XML vacío (sin datos de empleado)
 * que muestra la estructura esperada por CRA Internet File Transfer.
 *
 * En Año 2, esta función:
 *   - Iterará sobre empleados activos en el año fiscal.
 *   - Leerá grossPay, cppDeduction, eiDeduction, taxDeducted desde payroll.ts.
 *   - Generará un <Return> con múltiples <T4Slip> elementos.
 *   - Transmitirá vía CRA Internet File Transfer (XML sobre HTTPS).
 *
 * @param anio Año fiscal (ej. 2026).
 * @returns String XML con estructura T4 y datos placeholder vacíos.
 */
export function exportT4Xml(anio: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  T4 Statement of Remuneration Paid — XML Submission
  Generated: ${new Date().toISOString().slice(0, 10)}
  Tax Year: ${anio}
  Status: PLACEHOLDER (Year 2)

  TODO (Year 2):
  - Integrar con payroll.ts para leer grossPay, cppDeduction, eiDeduction
    y taxDeducted de cada empleado activo en el año fiscal.
  - Validar SIN numbers contra base de empleados.
  - Generar archivo de transmisión T4 completo (XML envelope + slips).
  - Conectar con CRA Internet File Transfer (requiere Web Access Code).
  - Probar en CRA sandbox antes de transmisión real.
  - Generar T4 Summary (T4SUM) junto con los slips individuales.

  CRA Internet File Transfer:
    https://apps.cra-arc.gc.ca/ebci/ieb0/upload/pub/disclaimer
  Requiere: Business Number, Web Access Code (WAC), PKI certificate.
  Fecha límite: último día de febrero del año siguiente.

  Cuentas COA relevantes:
    - 2020 Payroll Payable
    - 2025 Source Deductions Payable (CPP, EI, Income Tax)
    - 5010 Labour — Day Rate
    - 5020 Payroll Taxes — Employer portion
-->
<T4Return
  xmlns="http://www.cra-arc.gc.ca/T4/2024"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ReturnHeader>
    <EmployerBN>000000000RP0001</EmployerBN><!-- TODO: BN real -->
    <TaxYear>${anio}</TaxYear>
    <FilingType>ORIGINAL</FilingType>
    <TotalSlips>0</TotalSlips><!-- TODO: count active employees -->
  </ReturnHeader>

  <!--
    En Año 2, cada empleado genera un bloque <T4Slip>:

    <T4Slip>
      <EmployeeSIN>123456789</EmployeeSIN>
      <EmployeeName>
        <LastName>Smith</LastName>
        <FirstName>John</FirstName>
      </EmployeeName>
      <Box14>4500000</Box14>
      <Box16>225000</Box16>
      <Box18>72000</Box18>
      <Box22>675000</Box22>
      <Box24>4500000</Box24>
      <Box26>4500000</Box26>
      <Box28></Box28>
      <Box29></Box29>
    </T4Slip>
  -->

  <!-- PLACEHOLDER: sin slips. -->
</T4Return>
`;
}

// ---------------------------------------------------------------------------
// Adapter factory — CRA Journal Entries Export
// ---------------------------------------------------------------------------

/**
 * Crea un adaptador CRA para exportación de asientos contables.
 *
 * A diferencia de otros adaptadores, este delega en los formatos
 * específicos de CRA (GST NETFILE, T4 XML) en lugar de exportar
 * el libro diario genérico.
 *
 * `exportJournalEntries(periodo)` devuelve el GST NETFILE para el período
 * porque es el caso de uso principal del adaptador CRA (declaración mensual/
 * trimestral de impuestos).
 *
 * @param entries Arreglo completo de entradas del `financial_ledger`.
 * @returns Una instancia de `AccountingAdapter` que exporta a GST NETFILE XML.
 *
 * @example
 * ```ts
 * const adapter = createCraAdapter(entries);
 * const gstXml = adapter.exportJournalEntries("2026-08");
 * // En Año 2: transmitir gstXml a CRA NETFILE.
 * ```
 */
export const createCraAdapter: AccountingAdapterFactory = (
  _entries: FinancialLedgerEntry[]
): AccountingAdapter => ({
  formatName: "CRA GST NETFILE",
  mimeType: "application/xml",
  fileExtension: ".xml",

  exportJournalEntries(periodo: string): string {
    return exportGstReturn(periodo);
  },
});

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Función de conveniencia: exporta GST NETFILE XML para el período.
 *
 * Equivalente a:
 * ```ts
 * createCraAdapter(entries).exportJournalEntries(periodo)
 * ```
 *
 * @param entries Arreglo completo de entradas del ledger financiero.
 * @param periodo Período contable en formato YYYY-MM.
 * @returns String XML con estructura GST NETFILE (placeholder Year 2).
 */
export function exportJournalEntriesAsGstNetfile(
  entries: FinancialLedgerEntry[],
  periodo: string
): string | Buffer {
  return createCraAdapter(entries).exportJournalEntries(periodo);
}
