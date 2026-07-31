import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting, getSettingOrDefault } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 5.2 "Paso 3: Información Fiscal y Bancaria".
//
// Este servicio calcula los montos base de las formas TD1 (federal) y
// TD1BC (provincial de British Columbia) que un candidato/empleado nuevo
// debe llenar para que nómina sepa cuánto impuesto retener.
//
// ALCANCE REAL vs. formulario completo (léase antes de usar en
// producción): el TD1/TD1BC real tiene ~13 líneas (monto personal básico,
// monto por edad, monto por pensión, monto por discapacidad, monto por
// cónyuge/pareja de hecho, monto por cuidado de familiares, transferencia
// de créditos entre cónyuges, deducciones adicionales solicitadas por el
// empleado, etc.). Esta implementación SOLO cubre:
//   - Línea 1 federal: Basic personal amount (tax_federal_basic_personal_amount)
//   - Línea 1 BC (TD1BC): Basic personal amount provincial
//   - Un monto adicional de "claim" opcional que el candidato puede pedir
//     (claimAdditionalAmount), tratado como línea genérica sin desglosar en
//     categorías CRA específicas.
// NO están cubiertas: montos por edad/pensión/discapacidad/cónyuge/
// dependientes, ni las reglas de reducción cuando el ingreso neto supera
// ciertos umbrales (income threshold clawback de la línea 1 federal desde
// 2024+). Antes de usar este cálculo para nómina real, un contador debe
// revisar qué líneas adicionales aplican al empleado y extender esta
// función -- este archivo no reemplaza el formulario TD1/TD1BC completo.
//
// Todo monto de dinero se maneja como CENTAVOS ENTEROS (nunca float/
// Decimal para dinero -- regla dura del proyecto, mismo patrón usado en el
// resto del repo para montos monetarios).

type Td1Client = SupabaseClient<any, "public", any>;

export interface Td1CalculationInput {
  candidateId: string;
  // Monto de "claim adicional" opcional que el candidato puede solicitar
  // (ej. otras deducciones/créditos declarados en el formulario), en
  // CENTAVOS. No corresponde a ninguna línea CRA específica todavía -- ver
  // nota de alcance arriba. Default 0.
  claimAdditionalAmount?: number;
}

export interface Td1CalculationResult {
  federalBasicPersonalAmountCents: number;
  bcBasicPersonalAmountCents: number;
  claimAdditionalAmountCents: number;
  totalClaimAmountCents: number;
  taxYear: number;
  // TODAS las keys+valores de system_settings leídos para este cálculo,
  // sin excepción -- ver justificación de trazabilidad más abajo.
  settingsUsed: Record<string, unknown>;
}

// Convierte un monto en dólares (con decimales, como vienen guardados en
// system_settings, ej. "15705" o "17.85") a centavos enteros. Se redondea
// explícito con Math.round para nunca dejar un centavo fraccionario por
// error de punto flotante (ej. 0.1 + 0.2 en JS).
function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

// [ASSUMPTION -- falta seed en 254, agregar tax_bc_basic_personal_amount
// antes de producción]. La migración 254_hiring_flow_seed_system_settings.sql
// siembra tax_federal_basic_personal_amount, tax_year y payroll_min_wage_bc,
// pero NO siembra un monto personal básico provincial de BC (TD1BC línea
// 1). Usamos getSettingOrDefault con un placeholder explícito en vez de
// inventar un número "real" -- así nunca hay un cálculo silenciosamente
// incorrecto: el valor placeholder queda documentado tanto aquí como en
// settingsUsed, visible para quien audite el cálculo.
const BC_BASIC_PERSONAL_AMOUNT_PLACEHOLDER_DOLLARS = 12580;
const BC_BASIC_PERSONAL_AMOUNT_SETTING_KEY = "tax_bc_basic_personal_amount";

// ---------------------------------------------------------------------------
// calculateTd1
// ---------------------------------------------------------------------------

// Regla dura y explícita del plan v0.4.1: "antes de generar el PDF, loguea
// qué valores de settings se usaron (tax_year, tax_federal_basic_personal_amount,
// etc.). Si un contador reclama que el TD1 salió mal, necesitas
// trazabilidad." Por eso esta función:
//   1) Retorna `settingsUsed` con TODAS las keys+valores leídos de
//      system_settings, no solo los montos finales ya convertidos.
//   2) Hace console.log de un objeto JSON estructurado (candidateId,
//      taxYear, settingsUsed) en el momento del cálculo -- no como
//      afterthought agregado después, sino como parte del flujo normal de
//      cada llamada, para que quede en los logs de la invocación real que
//      generó un TD1 específico.
export async function calculateTd1(
  input: Td1CalculationInput,
  client?: Td1Client
): Promise<Td1CalculationResult> {
  const taxYear = Number(await getSetting("tax_year", client));
  const federalBasicPersonalAmountDollars = Number(
    await getSetting("tax_federal_basic_personal_amount", client)
  );
  const bcBasicPersonalAmountDollars = Number(
    await getSettingOrDefault(
      BC_BASIC_PERSONAL_AMOUNT_SETTING_KEY,
      BC_BASIC_PERSONAL_AMOUNT_PLACEHOLDER_DOLLARS,
      client
    )
  );

  if (!Number.isFinite(taxYear)) {
    throw new Error(`Invalid tax_year setting: expected a finite number, got "${taxYear}"`);
  }
  if (!Number.isFinite(federalBasicPersonalAmountDollars)) {
    throw new Error(
      `Invalid tax_federal_basic_personal_amount setting: expected a finite number, got "${federalBasicPersonalAmountDollars}"`
    );
  }
  if (!Number.isFinite(bcBasicPersonalAmountDollars)) {
    throw new Error(
      `Invalid ${BC_BASIC_PERSONAL_AMOUNT_SETTING_KEY} setting: expected a finite number, got "${bcBasicPersonalAmountDollars}"`
    );
  }

  const claimAdditionalAmountCents = input.claimAdditionalAmount ?? 0;
  if (!Number.isInteger(claimAdditionalAmountCents) || claimAdditionalAmountCents < 0) {
    throw new Error(
      `Invalid claimAdditionalAmount: expected a non-negative integer number of cents, got "${input.claimAdditionalAmount}"`
    );
  }

  const federalBasicPersonalAmountCents = dollarsToCents(federalBasicPersonalAmountDollars);
  const bcBasicPersonalAmountCents = dollarsToCents(bcBasicPersonalAmountDollars);

  const settingsUsed: Record<string, unknown> = {
    tax_year: taxYear,
    tax_federal_basic_personal_amount: federalBasicPersonalAmountDollars,
    [BC_BASIC_PERSONAL_AMOUNT_SETTING_KEY]: bcBasicPersonalAmountDollars,
  };

  // Log estructurado en el momento del cálculo -- no un afterthought.
  // Formato JSON para que sea parseable por herramientas de log
  // aggregation (ej. Vercel logs / Datadog) si hace falta reconstruir
  // "qué settings tenía el sistema cuando se generó el TD1 de este
  // candidato".
  console.log(
    JSON.stringify({
      event: "hiring_flow.td1_calculated",
      candidateId: input.candidateId,
      taxYear,
      settingsUsed,
    })
  );

  return {
    federalBasicPersonalAmountCents,
    bcBasicPersonalAmountCents,
    claimAdditionalAmountCents,
    totalClaimAmountCents:
      federalBasicPersonalAmountCents + bcBasicPersonalAmountCents + claimAdditionalAmountCents,
    taxYear,
    settingsUsed,
  };
}
