/**
 * v8.5 Capa 7 — Partner Tax: preparación de T4A para partners y property managers.
 *
 * Orquesta la obtención de earnings desde partner_commissions, el mapeo
 * a boxes de CRA (vía t4a-generator.ts), la detección de partners que
 * califican para T4A (>$500 en fees/services en el año calendario), y la
 * generación de cartas acompañantes para envío a los partners.
 *
 * Todas las funciones que tocan base de datos reciben el cliente Supabase
 * como parámetro explícito (patrón del proyecto). Las funciones de cálculo
 * puro delegan en t4a-generator.ts.
 *
 * REGLA: SIN/BN nunca completo en logs — solo últimos 3 dígitos visibles.
 * REGLA: montos en centavos enteros (CAD).
 *
 * Interconexiones:
 *   partner-tax.ts ──(usa)──→ t4a-generator.ts  (buildT4AAggregate, etc.)
 *   partner-tax.ts ──(usa)──→ partner-commissions.ts  (PartnerType)
 *   partner-tax.ts ──(usado por)──→ t4a-generator.ts  (generateT4ASubmissionXml)
 */

import { type SupabaseClient } from "@supabase/supabase-js";
import {
  buildT4AAggregate,
  generateT4ASlip,
  generateT4ASummary,
  type T4ARecipientInfo,
  type T4ASlip,
  type T4ASummary,
  type T4AYearlyAggregate,
} from "./t4a-generator";
import { type PartnerType } from "./partner-commissions";
import { vancouverDayRangeUtc } from "./date-utils";

// =========================================================================
// Constants
// =========================================================================

/** Umbral mínimo de CRA para emisión obligatoria de T4A: $500.00 CAD. */
export const T4A_MINIMUM_THRESHOLD_CENTS = 50_000;

// =========================================================================
// DB row shapes (snake_case, tal como vienen de Supabase)
// =========================================================================

interface PartnerCommissionRow {
  id: string;
  partner_id: string;
  order_id: string;
  order_value_cents: number;
  amount_cents: number;
  requires_t4a: boolean;
  description: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface PartnerRow {
  id: string;
  name: string;
  partner_type: PartnerType;
  tax_id_for_t4a: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
}

// =========================================================================
// Domain types
// =========================================================================

/** Earnings de un partner en un año fiscal. */
export interface PartnerEarnings {
  partnerId: string;
  taxYear: number;
  /** Total en centavos pagado al partner (suma de amount_cents de comisiones paid). */
  totalPaidCents: number;
  /** Cantidad de comisiones pagadas en el año. */
  commissionCount: number;
  /** Desglose por tipo de comisión. */
  commissions: Array<{
    commissionId: string;
    orderId: string;
    amountCents: number;
    paidAt: string;
    description: string;
  }>;
}

/** Cálculo de boxes CRA para un partner. */
export interface T4ABoxCalculation {
  partnerId: string;
  taxYear: number;
  partnerType: PartnerType;
  /** Aggregate listo para alimentar generateT4ASlip. */
  aggregate: T4AYearlyAggregate;
  /** Total pagado en el año (centavos). */
  totalPaidCents: number;
  /** Indica si el partner supera el umbral de $500 para T4A obligatorio. */
  exceedsThreshold: boolean;
}

/** Partner que califica para recibir T4A. */
export interface EligiblePartner {
  partnerId: string;
  name: string;
  partnerType: PartnerType;
  totalPaidCents: number;
  commissionCount: number;
  taxIdForT4A: string | null;
}

/** Resultado de getEligiblePartners. */
export interface EligiblePartnersResult {
  taxYear: number;
  partners: EligiblePartner[];
  /** Partners que califican pero no tienen tax_id_for_t4a registrado. */
  partnersMissingTaxId: EligiblePartner[];
}

/** Carta acompañante T4A para el partner. */
export interface T4ALetter {
  partnerId: string;
  taxYear: number;
  partnerName: string;
  recipientAddress: {
    line1: string;
    line2?: string;
    city: string;
    province: string;
    postalCode: string;
  };
  /** Total en dólares (formateado, 2 decimales). */
  totalAmountDisplay: string;
  /** Boxes CRA resumidos en lenguaje natural. */
  boxSummary: string[];
  /** Fecha límite de presentación ante CRA. */
  filingDeadline: string;
  /** Texto completo de la carta (plain text, listo para enviar). */
  bodyText: string;
  generatedAt: string;
}

// =========================================================================
// getPartnerEarnings()
// =========================================================================

/**
 * Obtiene los earnings (comisiones pagadas) de un partner específico
 * para un año fiscal dado.
 *
 * Consulta la tabla partner_commissions filtrando por partner_id, año
 * (según paid_at), y status = 'paid'. Las comisiones con deleted_at no
 * nulo se excluyen.
 *
 * @param supabase — Cliente Supabase con service_role.
 * @param partnerId — UUID del partner.
 * @param taxYear — Año fiscal (ej. 2026).
 * @returns PartnerEarnings con el total pagado y el detalle de comisiones.
 */
export async function getPartnerEarnings(
  supabase: SupabaseClient,
  partnerId: string,
  taxYear: number,
): Promise<PartnerEarnings> {
  // Fix (auditoria 2026-08-14): `partner_commissions.paid_at` es TIMESTAMPTZ y
  // el ano fiscal se delimitaba con strings sin offset, que Postgres lee en UTC
  // y no en America/Vancouver. Una comision pagada el 31-dic despues de las
  // ~16:00/17:00 hora local ya es 1-ene en UTC: quedaba fuera del T4A del ano
  // que le corresponde y se reportaba en el siguiente. Ademas corre el umbral
  // de $600 de elegibilidad sobre el conjunto equivocado.
  const { startUtc: startISO, endUtcExclusive: endISO } = vancouverDayRangeUtc(
    `${taxYear}-01-01`,
    `${taxYear}-12-31`
  );

  const { data, error } = await supabase
    .from("partner_commissions")
    .select(
      "id, partner_id, order_id, amount_cents, description, status, paid_at, created_at",
    )
    .eq("partner_id", partnerId)
    .eq("status", "paid")
    .gte("paid_at", startISO)
    .lt("paid_at", endISO)
    .is("deleted_at", null)
    .order("paid_at", { ascending: true });

  if (error) {
    throw new Error(
      `Error consultando partner_commissions para partner=${partnerId.slice(0, 8)}… año=${taxYear}: ${error.message}`,
    );
  }

  const rows = (data ?? []) as unknown as PartnerCommissionRow[];

  const commissions = rows.map((row) => ({
    commissionId: row.id,
    orderId: row.order_id,
    amountCents: row.amount_cents,
    paidAt: row.paid_at ?? row.created_at,
    description: row.description ?? "",
  }));

  const totalPaidCents = commissions.reduce((sum, c) => sum + c.amountCents, 0);

  return {
    partnerId,
    taxYear,
    totalPaidCents,
    commissionCount: commissions.length,
    commissions,
  };
}

// =========================================================================
// calculateT4ABoxes()
// =========================================================================

/**
 * Calcula los boxes de CRA (T4A) para un partner específico en un año fiscal.
 *
 * Obtiene los earnings vía getPartnerEarnings, determina el tipo de partner,
 * y construye el T4AYearlyAggregate usando buildT4AAggregate de t4a-generator.
 *
 * @param supabase — Cliente Supabase con service_role.
 * @param partnerId — UUID del partner.
 * @param taxYear — Año fiscal (ej. 2026).
 * @returns T4ABoxCalculation con el aggregate y el flag de umbral.
 */
export async function calculateT4ABoxes(
  supabase: SupabaseClient,
  partnerId: string,
  taxYear: number,
): Promise<T4ABoxCalculation> {
  // Obtener tipo de partner
  const { data: partner, error: partnerError } = await supabase
    .from("partners")
    .select("partner_type")
    .eq("id", partnerId)
    .single();

  if (partnerError || !partner) {
    throw new Error(
      `Partner no encontrado: partnerId=${partnerId.slice(0, 8)}…`,
    );
  }

  const partnerType = partner.partner_type as PartnerType;

  // Obtener earnings
  const earnings = await getPartnerEarnings(supabase, partnerId, taxYear);

  // Construir aggregate usando la función pura de t4a-generator
  const aggregate = buildT4AAggregate(
    earnings.totalPaidCents,
    partnerType,
    0, // incomeTaxDeductedCents: no hay retención en la fuente para partners
  );

  return {
    partnerId,
    taxYear,
    partnerType,
    aggregate,
    totalPaidCents: earnings.totalPaidCents,
    exceedsThreshold: earnings.totalPaidCents >= T4A_MINIMUM_THRESHOLD_CENTS,
  };
}

// =========================================================================
// getEligiblePartners()
// =========================================================================

/**
 * Identifica todos los partners que requieren T4A para un año fiscal dado.
 *
 * Un partner califica si:
 *   1. Tiene al menos una comisión con status='paid' en el año.
 *   2. El total pagado en el año supera $500 CAD (T4A_MINIMUM_THRESHOLD_CENTS).
 *
 * También retorna la sublista de partners que califican pero no tienen
 * tax_id_for_t4a registrado — estos deben actualizarse antes de emitir el T4A.
 *
 * @param supabase — Cliente Supabase con service_role.
 * @param taxYear — Año fiscal (ej. 2026).
 * @returns EligiblePartnersResult.
 */
export async function getEligiblePartners(
  supabase: SupabaseClient,
  taxYear: number,
): Promise<EligiblePartnersResult> {
  // Fix (auditoria 2026-08-14): `partner_commissions.paid_at` es TIMESTAMPTZ y
  // el ano fiscal se delimitaba con strings sin offset, que Postgres lee en UTC
  // y no en America/Vancouver. Una comision pagada el 31-dic despues de las
  // ~16:00/17:00 hora local ya es 1-ene en UTC: quedaba fuera del T4A del ano
  // que le corresponde y se reportaba en el siguiente. Ademas corre el umbral
  // de $600 de elegibilidad sobre el conjunto equivocado.
  const { startUtc: startISO, endUtcExclusive: endISO } = vancouverDayRangeUtc(
    `${taxYear}-01-01`,
    `${taxYear}-12-31`
  );

  // Obtener todas las comisiones pagadas del año, agrupadas por partner
  const { data, error } = await supabase
    .from("partner_commissions")
    .select(
      "partner_id, amount_cents, partners:partner_id ( id, name, partner_type, tax_id_for_t4a )",
    )
    .eq("status", "paid")
    .gte("paid_at", startISO)
    .lt("paid_at", endISO)
    .is("deleted_at", null);

  if (error) {
    throw new Error(
      `Error consultando partner_commissions para año=${taxYear}: ${error.message}`,
    );
  }

  // Agrupar por partner_id
  const partnerMap = new Map<
    string,
    {
      totalPaidCents: number;
      commissionCount: number;
      name: string;
      partnerType: PartnerType;
      taxIdForT4A: string | null;
    }
  >();

  for (const row of (data ?? []) as unknown as Array<{
    partner_id: string;
    amount_cents: number;
    partners: unknown;
  }>) {
    const existing = partnerMap.get(row.partner_id);
    if (existing) {
      existing.totalPaidCents += row.amount_cents;
      existing.commissionCount += 1;
    } else {
      // Extraer datos del partner del join anidado
      const partnerData = (
        Array.isArray(row.partners) ? row.partners[0] : row.partners
      ) as {
        id?: string;
        name?: string;
        partner_type?: string;
        tax_id_for_t4a?: string | null;
      } | null;

      partnerMap.set(row.partner_id, {
        totalPaidCents: row.amount_cents,
        commissionCount: 1,
        name: partnerData?.name ?? "Desconocido",
        partnerType: (partnerData?.partner_type as PartnerType) ?? "property_manager",
        taxIdForT4A: partnerData?.tax_id_for_t4a ?? null,
      });
    }
  }

  // Filtrar por umbral de $500 y ordenar por monto descendente
  const eligible: EligiblePartner[] = [];
  const missingTaxId: EligiblePartner[] = [];

  partnerMap.forEach((info, partnerId) => {
    if (info.totalPaidCents < T4A_MINIMUM_THRESHOLD_CENTS) return;

    const entry: EligiblePartner = {
      partnerId,
      name: info.name,
      partnerType: info.partnerType,
      totalPaidCents: info.totalPaidCents,
      commissionCount: info.commissionCount,
      taxIdForT4A: info.taxIdForT4A,
    };

    eligible.push(entry);

    if (!info.taxIdForT4A || !info.taxIdForT4A.trim()) {
      missingTaxId.push(entry);
    }
  });

  // Ordenar por monto descendente
  eligible.sort((a, b) => b.totalPaidCents - a.totalPaidCents);
  missingTaxId.sort((a, b) => b.totalPaidCents - a.totalPaidCents);

  return {
    taxYear,
    partners: eligible,
    partnersMissingTaxId: missingTaxId,
  };
}

// =========================================================================
// generateT4ALetter()
// =========================================================================

/**
 * Genera una carta acompañante para enviar al partner junto con su T4A slip.
 *
 * La carta incluye:
 *  - Datos del partner (nombre, dirección).
 *  - Año fiscal y monto total reportado.
 *  - Desglose de boxes CRA aplicables en lenguaje natural.
 *  - Fecha límite de presentación ante CRA (último día de febrero).
 *  - Instrucciones para el partner.
 *
 * @param supabase — Cliente Supabase con service_role.
 * @param partnerId — UUID del partner.
 * @param taxYear — Año fiscal (ej. 2026).
 * @returns T4ALetter con el texto completo de la carta.
 */
export async function generateT4ALetter(
  supabase: SupabaseClient,
  partnerId: string,
  taxYear: number,
): Promise<T4ALetter> {
  // Obtener datos del partner
  const { data: partner, error: partnerError } = await supabase
    .from("partners")
    .select(
      "id, name, partner_type, tax_id_for_t4a, address_line1, address_line2, city, province, postal_code",
    )
    .eq("id", partnerId)
    .single();

  if (partnerError || !partner) {
    throw new Error(
      `Partner no encontrado: partnerId=${partnerId.slice(0, 8)}…`,
    );
  }

  const partnerRow = partner as unknown as PartnerRow;

  // Obtener earnings y cálculo de boxes
  const boxCalc = await calculateT4ABoxes(supabase, partnerId, taxYear);

  // Construir resumen de boxes en lenguaje natural
  const boxSummary: string[] = [];

  if (boxCalc.aggregate.selfEmployedCommissionsCents > 0) {
    boxSummary.push(
      `Box 020 — Self-employed commissions: $${(boxCalc.aggregate.selfEmployedCommissionsCents / 100).toFixed(2)}`,
    );
  }
  if (boxCalc.aggregate.feesForServicesCents > 0) {
    boxSummary.push(
      `Box 048 — Fees for services: $${(boxCalc.aggregate.feesForServicesCents / 100).toFixed(2)}`,
    );
  }
  if (boxCalc.aggregate.incomeTaxDeductedCents > 0) {
    boxSummary.push(
      `Box 022 — Income tax deducted: $${(boxCalc.aggregate.incomeTaxDeductedCents / 100).toFixed(2)}`,
    );
  }
  if (boxCalc.aggregate.otherIncomeCents > 0) {
    boxSummary.push(
      `Box 028 — Other income: $${(boxCalc.aggregate.otherIncomeCents / 100).toFixed(2)}`,
    );
  }
  if (boxCalc.aggregate.pensionOrSuperannuationCents > 0) {
    boxSummary.push(
      `Box 016 — Pension or superannuation: $${(boxCalc.aggregate.pensionOrSuperannuationCents / 100).toFixed(2)}`,
    );
  }

  const totalDisplay = `$${(boxCalc.totalPaidCents / 100).toFixed(2)}`;

  // Fecha límite: último día de febrero del año siguiente
  const filingDeadline = getT4AFilingDeadlineRaw(taxYear);

  const address = {
    line1: partnerRow.address_line1 ?? "",
    line2: partnerRow.address_line2 ?? undefined,
    city: partnerRow.city ?? "",
    province: partnerRow.province ?? "BC",
    postalCode: partnerRow.postal_code ?? "",
  };

  const bodyText = [
    `${partnerRow.name}`,
    `${address.line1}${address.line2 ? `, ${address.line2}` : ""}`,
    `${address.city}, ${address.province}  ${address.postalCode}`,
    "",
    `Fecha: ${new Date().toISOString().slice(0, 10)}`,
    "",
    `Ref: T4A — Statement of Pension, Retirement, Annuity, and Other Income`,
    `Año fiscal: ${taxYear}`,
    "",
    `Estimado/a ${partnerRow.name.split(" ")[0] ?? partnerRow.name},`,
    "",
    `Adjunto encontrarás tu T4A slip correspondiente al año fiscal ${taxYear}, emitido por Lulu Island Flagship Services Inc.`,
    "",
    `Este documento reporta un total de ${totalDisplay} CAD en pagos realizados durante el año, distribuidos de la siguiente manera según los boxes de la Canada Revenue Agency (CRA):`,
    "",
    ...boxSummary.map((b) => `  • ${b}`),
    "",
    `Este T4A ha sido presentado electrónicamente ante la CRA. La fecha límite de presentación es el ${filingDeadline}.`,
    "",
    `Qué debes hacer:`,
    `  1. Revisa que los montos coincidan con tus registros.`,
    `  2. Incluye esta información en tu declaración de impuestos (T1) bajo la sección de "Other Income".`,
    `  3. Si eres una corporación, incluye los montos en tu T2 return.`,
    `  4. Conserva este documento junto con tus registros fiscales por al menos 6 años.`,
    "",
    `Si tienes alguna pregunta sobre los montos reportados, por favor contacta a finance@luluislandflagship.com antes del ${filingDeadline}.`,
    "",
    `Atentamente,`,
    `Lulu Island Flagship Services Inc.`,
    `Finance Department`,
    `finance@luluislandflagship.com`,
    `BN: ${"123456789RP0001".slice(-4)}`,
  ].join("\n");

  return {
    partnerId,
    taxYear,
    partnerName: partnerRow.name,
    recipientAddress: address,
    totalAmountDisplay: totalDisplay,
    boxSummary,
    filingDeadline,
    bodyText,
    generatedAt: new Date().toISOString(),
  };
}

// =========================================================================
// getT4AFilingDeadlineRaw (helper interno)
// =========================================================================

/**
 * Calcula la fecha límite de presentación T4A: último día de febrero
 * del año siguiente al año fiscal.
 *
 * Si el último día de febrero cae en fin de semana, se ajusta al siguiente
 * día hábil (política CRA). Esta es la versión interna raw; la versión
 * exportada está en t4a-generator.ts.
 *
 * @param taxYear — Año fiscal.
 * @returns Fecha ISO 8601 (YYYY-MM-DD).
 */
function getT4AFilingDeadlineRaw(taxYear: number): string {
  const dueYear = taxYear + 1;
  // Febrero: determinar último día (28 o 29 en año bisiesto)
  const lastDay = new Date(Date.UTC(dueYear, 2, 0)).getUTCDate(); // día 0 de marzo = último de febrero
  const rawDeadline = `${String(dueYear).padStart(4, "0")}-02-${String(lastDay).padStart(2, "0")}`;

  // Ajuste simple de fin de semana (sin dependencia de nextBusinessDay
  // para mantener este archivo autocontenido en cuanto a la carta).
  // La versión canónica con nextBusinessDay está en t4a-generator.ts.
  const deadline = new Date(`${rawDeadline}T00:00:00.000Z`);
  const dow = deadline.getUTCDay();
  if (dow === 0) {
    // Domingo → lunes
    deadline.setUTCDate(deadline.getUTCDate() + 1);
  } else if (dow === 6) {
    // Sábado → lunes
    deadline.setUTCDate(deadline.getUTCDate() + 2);
  }
  return deadline.toISOString().slice(0, 10);
}

// =========================================================================
// generateT4ASlipsForYear (helper de orquestación)
// =========================================================================

/**
 * Genera todos los T4A slips para los partners elegibles de un año fiscal.
 *
 * Itera sobre getEligiblePartners, calcula los boxes para cada uno,
 * construye el T4ARecipientInfo, y genera el T4ASlip vía generateT4ASlip.
 *
 * @param supabase — Cliente Supabase con service_role.
 * @param taxYear — Año fiscal (ej. 2026).
 * @returns Array de T4ASlip y el T4ASummary correspondiente.
 */
export async function generateT4ASlipsForYear(
  supabase: SupabaseClient,
  taxYear: number,
): Promise<{ slips: T4ASlip[]; summary: T4ASummary }> {
  const { partners, partnersMissingTaxId } =
    await getEligiblePartners(supabase, taxYear);

  if (partnersMissingTaxId.length > 0) {
    const names = partnersMissingTaxId
      .map((p) => `${p.name} (${p.partnerId.slice(0, 8)}…)`)
      .join(", ");
    throw new Error(
      `Los siguientes partners califican para T4A pero no tienen tax_id_for_t4a: ${names}`,
    );
  }

  const slips: T4ASlip[] = [];

  for (const eligible of partners) {
    // Obtener datos completos del partner para el T4ARecipientInfo
    const { data: partner, error: partnerError } = await supabase
      .from("partners")
      .select(
        "id, name, partner_type, tax_id_for_t4a, address_line1, address_line2, city, province, postal_code",
      )
      .eq("id", eligible.partnerId)
      .single();

    if (partnerError || !partner) {
      throw new Error(
        `Partner no encontrado durante generación de slips: ${eligible.partnerId.slice(0, 8)}…`,
      );
    }

    const partnerRow = partner as unknown as PartnerRow;
    const boxCalc = await calculateT4ABoxes(supabase, eligible.partnerId, taxYear);

    const isBusinessNumber =
      (partnerRow.tax_id_for_t4a?.length ?? 0) === 15;

    const recipientInfo: T4ARecipientInfo = {
      partnerId: eligible.partnerId,
      legalName: partnerRow.name,
      partnerType: partnerRow.partner_type,
      address: {
        line1: partnerRow.address_line1 ?? "",
        line2: partnerRow.address_line2 ?? undefined,
        city: partnerRow.city ?? "",
        province: partnerRow.province ?? "BC",
        postalCode: partnerRow.postal_code ?? "",
      },
      recipientBN: partnerRow.tax_id_for_t4a ?? "",
      isBusinessNumber,
    };

    const slip = generateT4ASlip(recipientInfo, boxCalc.aggregate, taxYear);
    slips.push(slip);
  }

  const summary = generateT4ASummary(slips, taxYear);

  return { slips, summary };
}
