import { dollarsToCentsExact } from "./money";

/**
 * Capa 6 — Tax XSD Validator: validación estructural de XMLs fiscales
 * canadienses contra los schemas de CRA y Service Canada.
 *
 * Valida la estructura, elementos requeridos, tipos de datos, y restricciones
 * de formato de los XMLs generados para NETFILE/ROE Web antes de su envío.
 *
 * Formatos soportados:
 *   - GST/HST Return (CRA T619 NETFILE)
 *   - T4 Statement of Remuneration Paid (CRA T619)
 *   - T4A Statement of Pension/Other Income (CRA T4A XML)
 *   - ROE Record of Employment (Service Canada ROE Web)
 *
 * Todas las funciones son puras: reciben un string XML y devuelven un
 * resultado de validación estructurado. No tocan base de datos ni APIs.
 *
 * Interconexiones:
 *   tax-xsd-validator.ts ──(usado por)──→ tax-netfile.ts
 *   tax-xsd-validator.ts ──(usado por)──→ t4-submission.ts
 *   tax-xsd-validator.ts ──(usado por)──→ roe-submission.ts
 */

// =========================================================================
// Types
// =========================================================================

/**
 * Resultado de validación de un XML fiscal.
 *
 * El campo `valid` es true solo si no hay errores (las advertencias
 * no bloquean la validez).
 */
export interface TaxXmlValidationResult {
  /** true si el XML pasó todas las validaciones de estructura. */
  valid: boolean;
  /** Errores que bloquean la validez (elementos faltantes, formato inválido). */
  errors: string[];
  /** Advertencias que no bloquean pero deben revisarse. */
  warnings: string[];
  /** Tipo de formulario validado. */
  formType: FormType;
  /** Timestamp ISO 8601 de la validación. */
  validatedAt: string;
}

/** Tipos de formulario fiscal soportados. */
export type FormType = "GST" | "T4" | "T4A" | "ROE";

/**
 * Definición de un schema XSD para un formulario fiscal.
 *
 * No carga el archivo XSD real (requiere parser externo), sino que
 * describe las reglas de validación que se aplicarán programáticamente.
 */
export interface XsdSchemaDefinition {
  /** Tipo de formulario. */
  formType: FormType;
  /** Namespace XML esperado. */
  namespace: string;
  /** Elemento raíz esperado. */
  rootElement: string;
  /** Elementos requeridos en el XML. */
  requiredElements: string[];
  /** Elementos opcionales conocidos. */
  optionalElements: string[];
  /** Atributos requeridos en el elemento raíz. */
  requiredRootAttributes: string[];
  /** Patrones de formato para campos clave (elemento → regex). */
  fieldPatterns: Record<string, RegExp>;
  /** Referencia al schema oficial de CRA / Service Canada. */
  craReference: string;
}

// =========================================================================
// XML Parsing Helpers (lightweight, no external deps)
// =========================================================================

/**
 * Extrae el contenido de texto de un elemento XML por nombre de tag.
 * Soporta tags con namespace (ej. `<ns:Tag>value</ns:Tag>`) y tags simples.
 *
 * @param xml — Contenido XML completo.
 * @param tagName — Nombre del tag (sin namespace prefix).
 * @returns Contenido del primer match, o null si no se encuentra.
 */
function extractElementContent(xml: string, tagName: string): string | null {
  // Match tags with optional namespace prefix: <prefix:TagName> or <TagName>
  const regex = new RegExp(
    `<(?:\\w+:)?${escapeRegex(tagName)}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escapeRegex(tagName)}>`,
    "i",
  );
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

/**
 * Extrae todos los contenidos de un elemento que puede aparecer múltiples veces.
 */
function extractAllElementContents(xml: string, tagName: string): string[] {
  const regex = new RegExp(
    `<(?:\\w+:)?${escapeRegex(tagName)}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escapeRegex(tagName)}>`,
    "gi",
  );
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

/**
 * Verifica si un elemento existe en el XML (al menos una ocurrencia).
 */
function hasElement(xml: string, tagName: string): boolean {
  const regex = new RegExp(`<(?:\\w+:)?${escapeRegex(tagName)}[\\s>]`, "i");
  return regex.test(xml);
}

/**
 * Extrae el valor de un atributo del elemento raíz.
 */
function extractRootAttribute(xml: string, attrName: string): string | null {
  // Busca el primer elemento (raíz) y extrae el atributo
  const rootRegex = /<(\w+(?::\w+)?)\s([^>]*)>/;
  const match = rootRegex.exec(xml);
  if (!match) return null;
  const attrs = match[2];
  const attrRegex = new RegExp(`${escapeRegex(attrName)}\\s*=\\s*"([^"]*)"`, "i");
  const attrMatch = attrRegex.exec(attrs);
  return attrMatch ? attrMatch[1] : null;
}

/**
 * Verifica si un valor coincide con un patrón de regex.
 */
function matchesPattern(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =========================================================================
// XSD Schema Definitions
// =========================================================================

/**
 * Schema definitions for all supported CRA/Service Canada XML formats.
 *
 * Cada entry describe las reglas de validación estructural que el XML
 * debe cumplir para ser considerado válido para transmisión electrónica.
 */
const XSD_SCHEMAS: Record<FormType, XsdSchemaDefinition> = {
  GST: {
    formType: "GST",
    namespace: "http://www.cra-arc.gc.ca/gncy/bn",
    rootElement: "GSTHSTReturn",
    requiredElements: [
      "TransmissionHeader",
      "TransmissionID",
      "TransmissionDate",
      "RegistrantInformation",
      "BusinessNumber",
      "ReportingPeriod",
      "FiscalPeriodStart",
      "FiscalPeriodEnd",
      "GSTCollected",
      "InputTaxCredits",
      "NetTax",
      "TotalSales",
    ],
    optionalElements: [
      "InstallmentPayments",
      "Rebates",
      "TaxWithheld",
      "PSTCollected",
      "TransmitterSoftwareCode",
      "TransmitterSoftwareVersion",
    ],
    requiredRootAttributes: ["xmlns", "returnType", "referencePeriod"],
    fieldPatterns: {
      BusinessNumber: /^\d{9}RT\d{4}$/,
      TransmissionDate: /^\d{4}-\d{2}-\d{2}$/,
      FiscalPeriodStart: /^\d{4}-\d{2}-\d{2}$/,
      FiscalPeriodEnd: /^\d{4}-\d{2}-\d{2}$/,
      GSTCollected: /^-?\d+(\.\d{1,2})?$/,
      InputTaxCredits: /^-?\d+(\.\d{1,2})?$/,
      NetTax: /^-?\d+(\.\d{1,2})?$/,
      TotalSales: /^\d+(\.\d{1,2})?$/,
    },
    craReference: "CRA T619 Electronic Filing — GST/HST Return XML Schema",
  },

  T4: {
    formType: "T4",
    namespace: "http://www.cra-arc.gc.ca/xml/t619/2026",
    rootElement: "T619",
    requiredElements: [
      "Transmitter",
      "BusinessNumber",
      "Return",
      "Employer",
      "LegalName",
      "T4Summary",
      "TotalSlips",
      "TotalIncome",
      "TotalTaxDeducted",
    ],
    optionalElements: [
      "T4Slip",
      "ContactName",
      "ContactPhone",
      "ContactEmail",
      "OperatingName",
      "AddressLine2",
      "Box28",
      "Box44",
      "Box46",
      "Box50",
      "Box52",
      "Box55",
      "Box56",
    ],
    requiredRootAttributes: ["xmlns", "submissionReferenceID", "taxYear", "transmissionType"],
    fieldPatterns: {
      BusinessNumber: /^\d{9}RP\d{4}$/,
      SIN: /^(\d{9}|\*\*\* \*\*\* \d{3})$/,
      taxYear: /^\d{4}$/,
      transmissionType: /^[OAT]$/,
      TotalSlips: /^\d+$/,
      TotalIncome: /^\d+(\.\d{1,2})?$/,
      TotalTaxDeducted: /^\d+(\.\d{1,2})?$/,
      Box14: /^\d+(\.\d{1,2})?$/,
      Box16: /^\d+(\.\d{1,2})?$/,
      Box18: /^\d+(\.\d{1,2})?$/,
      Box22: /^\d+(\.\d{1,2})?$/,
      Box24: /^\d+(\.\d{1,2})?$/,
      Box26: /^\d+(\.\d{1,2})?$/,
    },
    craReference: "CRA T619 XML Schema v26 — T4 Statement of Remuneration Paid",
  },

  T4A: {
    formType: "T4A",
    namespace: "http://www.cra-arc.gc.ca/xml/t619/2026",
    rootElement: "T4ASubmission",
    requiredElements: [
      "TaxYear",
      "Payer",
      "PayerLegalName",
      "PayerBN",
      "Recipient",
      "RecipientName",
      "RecipientIdentifier",
      "T4ABoxes",
    ],
    optionalElements: [
      "Box016",
      "Box020",
      "Box022",
      "Box028",
      "Box048",
      "PayerOperatingName",
      "AddressLine2",
      "RecipientAddressLine2",
    ],
    requiredRootAttributes: ["xmlns", "taxYear", "submissionID"],
    fieldPatterns: {
      TaxYear: /^\d{4}$/,
      PayerBN: /^\d{9}RP\d{4}$/,
      RecipientIdentifier: /^(\d{9}|\d{9}RT\d{4}|\d{9}RP\d{4})$/,
      Box016: /^\d+(\.\d{1,2})?$/,
      Box020: /^\d+(\.\d{1,2})?$/,
      Box022: /^\d+(\.\d{1,2})?$/,
      Box028: /^\d+(\.\d{1,2})?$/,
      Box048: /^\d+(\.\d{1,2})?$/,
    },
    craReference: "CRA T4A XML Schema — Statement of Pension, Retirement, Annuity, and Other Income",
  },

  ROE: {
    formType: "ROE",
    namespace: "http://www.servicecanada.gc.ca/xml/roe/2026",
    rootElement: "RecordOfEmployment",
    requiredElements: [
      "SerialNumber",
      "Employer",
      "EmployerLegalName",
      "EmployerBN",
      "Employee",
      "EmployeeLegalName",
      "SIN",
      "FirstDayWorked",
      "LastDayWorked",
      "TerminationDate",
      "TerminationCode",
      "FinalPayPeriodStart",
      "FinalPayPeriodEnd",
      "FinalPeriodInsurableEarnings",
      "FinalPeriodInsurableHours",
      "TotalInsurableEarnings",
      "TotalInsurableHours",
      "PayPeriodCount",
    ],
    optionalElements: [
      "EmployerOperatingName",
      "ExpectedRecallDate",
      "Comments",
      "DeliveryMethod",
      "AddressLine2",
    ],
    requiredRootAttributes: ["xmlns", "serialNumber", "generatedDate"],
    fieldPatterns: {
      SerialNumber: /^ROE-[A-Z0-9]{6}-\d{4}$/,
      EmployerBN: /^\d{9}RP\d{4}$/,
      SIN: /^(\d{9}|\*\*\* \*\*\* \d{3})$/,
      FirstDayWorked: /^\d{4}-\d{2}-\d{2}$/,
      LastDayWorked: /^\d{4}-\d{2}-\d{2}$/,
      TerminationDate: /^\d{4}-\d{2}-\d{2}$/,
      TerminationCode: /^[A-NP-Z]$/,
      FinalPayPeriodStart: /^\d{4}-\d{2}-\d{2}$/,
      FinalPayPeriodEnd: /^\d{4}-\d{2}-\d{2}$/,
      FinalPeriodInsurableEarnings: /^\d+(\.\d{1,2})?$/,
      FinalPeriodInsurableHours: /^\d+(\.\d{1,2})?$/,
      TotalInsurableEarnings: /^\d+(\.\d{1,2})?$/,
      TotalInsurableHours: /^\d+(\.\d{1,2})?$/,
      PayPeriodCount: /^\d+$/,
      generatedDate: /^\d{4}-\d{2}-\d{2}$/,
    },
    craReference: "Service Canada ROE Web XML Schema — INS3166 Record of Employment",
  },
};

// =========================================================================
// Core validation logic
// =========================================================================

/**
 * Valida un XML genérico contra la definición de schema dada.
 *
 * Realiza las siguientes comprobaciones:
 *   1. Declaración XML presente.
 *   2. Elemento raíz correcto con namespace.
 *   3. Atributos requeridos del elemento raíz.
 *   4. Elementos requeridos presentes.
 *   5. Patrones de formato en campos clave.
 *   6. Well-formedness básica (tags balanceados).
 *
 * @param xml — Contenido XML a validar.
 * @param schema — Definición del schema contra el cual validar.
 * @returns TaxXmlValidationResult con errores y advertencias.
 */
function validateXmlAgainstSchema(
  xml: string,
  schema: XsdSchemaDefinition,
): TaxXmlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── 1. Declaración XML ──────────────────────────────────────────────────
  if (!xml.trim().startsWith("<?xml")) {
    errors.push("Falta la declaración XML (<?xml version=\"1.0\" encoding=\"UTF-8\"?>).");
  }

  // ── 2. Elemento raíz ────────────────────────────────────────────────────
  const rootOpenRegex = new RegExp(`<${escapeRegex(schema.rootElement)}\\b`, "i");
  const rootCloseRegex = new RegExp(`</${escapeRegex(schema.rootElement)}>`, "i");

  if (!rootOpenRegex.test(xml)) {
    errors.push(
      `Falta el elemento raíz <${schema.rootElement}> esperado para ${schema.formType}.`,
    );
  }
  if (!rootCloseRegex.test(xml)) {
    errors.push(
      `Falta el cierre del elemento raíz </${schema.rootElement}>.`,
    );
  }

  // ── 3. Namespace ────────────────────────────────────────────────────────
  if (schema.namespace && !xml.includes(schema.namespace)) {
    warnings.push(
      `Namespace esperado "${schema.namespace}" no encontrado en el XML.`,
    );
  }

  // ── 4. Atributos requeridos del elemento raíz ───────────────────────────
  for (const attr of schema.requiredRootAttributes) {
    const value = extractRootAttribute(xml, attr);
    if (value === null) {
      errors.push(
        `Falta el atributo requerido "${attr}" en <${schema.rootElement}>.`,
      );
    } else if (schema.fieldPatterns[attr] && !matchesPattern(value, schema.fieldPatterns[attr])) {
      errors.push(
        `Atributo "${attr}" con valor "${value}" no cumple el patrón esperado.`,
      );
    }
  }

  // ── 5. Elementos requeridos ─────────────────────────────────────────────
  for (const elem of schema.requiredElements) {
    if (!hasElement(xml, elem)) {
      errors.push(
        `Falta el elemento requerido <${elem}> para ${schema.formType}.`,
      );
    }
  }

  // ── 6. Validación de patrones en campos clave ───────────────────────────
  for (const [field, pattern] of Object.entries(schema.fieldPatterns)) {
    // Skip root attributes — they were validated above
    if (schema.requiredRootAttributes.includes(field)) continue;

    const contents = extractAllElementContents(xml, field);
    for (let i = 0; i < contents.length; i++) {
      if (!matchesPattern(contents[i], pattern)) {
        errors.push(
          `<${field}> #${i + 1} con valor "${contents[i].slice(0, 50)}" no cumple el patrón esperado.`,
        );
      }
    }
  }

  // ── 7. Well-formedness básica: balance de tags ──────────────────────────
  const openTags = xml.match(/<\w+/g);
  const closeTags = xml.match(/<\/\w+/g);
  if (openTags && closeTags && openTags.length !== closeTags.length) {
    errors.push("XML mal formado: número desigual de tags de apertura y cierre.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    formType: schema.formType,
    validatedAt: new Date().toISOString(),
  };
}

// =========================================================================
// Public API — per-form validators
// =========================================================================

/**
 * Valida un XML de GST/HST Return contra el schema CRA T619 NETFILE.
 *
 * Verifica estructura, elementos requeridos (BusinessNumber, ReportingPeriod,
 * GSTCollected, InputTaxCredits, NetTax), atributos del elemento raíz,
 * y patrones de formato para campos fiscales clave.
 *
 * @param xml — String XML del GST/HST return generado por generateGstReturnXml().
 * @returns TaxXmlValidationResult con errores y advertencias.
 *
 * @example
 * ```ts
 * const result = validateGstXml(gstXml);
 * if (!result.valid) {
 *   console.error("GST XML inválido:", result.errors);
 * }
 * ```
 */
export function validateGstXml(xml: string): TaxXmlValidationResult {
  const base = validateXmlAgainstSchema(xml, XSD_SCHEMAS.GST);

  // ── GST-specific cross-field validations ────────────────────────────────
  const gstCollected = extractElementContent(xml, "GSTCollected");
  const itcs = extractElementContent(xml, "InputTaxCredits");
  const netTax = extractElementContent(xml, "NetTax");

  if (gstCollected && itcs && netTax) {
    const collectedNum = parseFloat(gstCollected);
    const itcsNum = parseFloat(itcs);
    const netNum = parseFloat(netTax);
    const expectedNet = Number(dollarsToCentsExact(collectedNum) - dollarsToCentsExact(itcsNum)) / 100;

    if (Math.abs(netNum - expectedNet) > 0.02) {
      base.errors.push(
        `NetTax (${netNum}) no cuadra con GSTCollected (${collectedNum}) − InputTaxCredits (${itcsNum}) = ${expectedNet}.`,
      );
    }
  }

  // Check period consistency
  const periodStart = extractElementContent(xml, "FiscalPeriodStart");
  const periodEnd = extractElementContent(xml, "FiscalPeriodEnd");
  if (periodStart && periodEnd && periodStart > periodEnd) {
    base.errors.push(
      `FiscalPeriodStart (${periodStart}) es posterior a FiscalPeriodEnd (${periodEnd}).`,
    );
  }

  base.valid = base.errors.length === 0;
  return base;
}

/**
 * Valida un XML de T4 Submission contra el schema CRA T619.
 *
 * Verifica estructura T619, presencia del Transmitter, Employer, T4Slips
 * con todos los boxes obligatorios, y consistencia entre el T4Summary
 * y los slips individuales.
 *
 * @param xml — String XML del T4 submission generado por generateT4SubmissionXml().
 * @returns TaxXmlValidationResult con errores y advertencias.
 *
 * @example
 * ```ts
 * const result = validateT4Xml(t4Xml);
 * if (!result.valid) {
 *   console.error("T4 XML inválido:", result.errors);
 * }
 * ```
 */
export function validateT4Xml(xml: string): TaxXmlValidationResult {
  const base = validateXmlAgainstSchema(xml, XSD_SCHEMAS.T4);

  // ── T4-specific cross-field validations ─────────────────────────────────

  // Check mandatory boxes in each T4 slip
  const slipSections = xml.split(/<T4Slip>/i).slice(1);
  const mandatoryBoxes = ["Box14", "Box16", "Box18", "Box22", "Box24", "Box26"];

  if (slipSections.length === 0) {
    base.warnings.push("No se encontraron <T4Slip> — ¿no hay empleados para este año fiscal?");
  }

  for (let i = 0; i < slipSections.length; i++) {
    const slipContent = slipSections[i].split(/<\/T4Slip>/i)[0] ?? "";

    for (const box of mandatoryBoxes) {
      if (!new RegExp(`<${box}>`, "i").test(slipContent)) {
        base.errors.push(`T4Slip #${i + 1}: falta el box obligatorio <${box}>.`);
      }
    }

    // Cross-box constraints per CRA rules
    const box14 = extractValue(slipContent, "Box14");
    const box26 = extractValue(slipContent, "Box26");
    const box24 = extractValue(slipContent, "Box24");
    const box16 = extractValue(slipContent, "Box16");
    const box18 = extractValue(slipContent, "Box18");

    // Box 26 (CPP pensionable earnings) should not exceed Box 14
    if (box14 !== null && box26 !== null && box26 > box14) {
      base.errors.push(
        `T4Slip #${i + 1}: Box26 (CPP pensionable earnings = ${box26}) excede Box14 (employment income = ${box14}).`,
      );
    }

    // Box 24 (EI insurable earnings) should not exceed Box 14
    if (box14 !== null && box24 !== null && box24 > box14) {
      base.errors.push(
        `T4Slip #${i + 1}: Box24 (EI insurable earnings = ${box24}) excede Box14 (employment income = ${box14}).`,
      );
    }

    // Box 16 (CPP) without corresponding Box 26 is suspicious
    if (box16 !== null && box16 > 0 && (box26 === null || box26 === 0)) {
      base.warnings.push(
        `T4Slip #${i + 1}: Box16 (CPP = ${box16}) tiene valor pero Box26 (CPP pensionable earnings) es 0.`,
      );
    }

    // Box 18 (EI) without corresponding Box 24 is suspicious
    if (box18 !== null && box18 > 0 && (box24 === null || box24 === 0)) {
      base.warnings.push(
        `T4Slip #${i + 1}: Box18 (EI = ${box18}) tiene valor pero Box24 (EI insurable earnings) es 0.`,
      );
    }

    // SIN format in each slip
    const sinMatch = slipContent.match(/<SIN>([^<]+)<\/SIN>/i);
    if (sinMatch) {
      const sinValue = sinMatch[1].trim();
      if (!/^(\d{9}|\*\*\* \*\*\* \d{3})$/.test(sinValue)) {
        base.errors.push(
          `T4Slip #${i + 1}: SIN con formato inválido "${sinValue}".`,
        );
      }
    }
  }

  // ── T4 Summary vs slips consistency ─────────────────────────────────────
  const allBox14 = extractAllBoxValues(xml, "Box14");
  const allBox22 = extractAllBoxValues(xml, "Box22");
  const totalIncome = extractElementContent(xml, "TotalIncome");
  const totalTaxDeducted = extractElementContent(xml, "TotalTaxDeducted");

  if (allBox14.length > 0 && totalIncome) {
    const slipSum14 = allBox14.reduce((a, b) => a + b, 0);
    const summaryTotal14 = parseFloat(totalIncome);
    if (Math.abs(slipSum14 - summaryTotal14) > 0.02) {
      base.errors.push(
        `TotalIncome (${summaryTotal14.toFixed(2)}) no cuadra con la suma de Box14 de los slips (${slipSum14.toFixed(2)}).`,
      );
    }
  }

  if (allBox22.length > 0 && totalTaxDeducted) {
    const slipSum22 = allBox22.reduce((a, b) => a + b, 0);
    const summaryTotal22 = parseFloat(totalTaxDeducted);
    if (Math.abs(slipSum22 - summaryTotal22) > 0.02) {
      base.errors.push(
        `TotalTaxDeducted (${summaryTotal22.toFixed(2)}) no cuadra con la suma de Box22 de los slips (${slipSum22.toFixed(2)}).`,
      );
    }
  }

  // Check slip count
  const totalSlips = extractElementContent(xml, "TotalSlips");
  if (totalSlips && parseInt(totalSlips, 10) !== slipSections.length) {
    base.errors.push(
      `TotalSlips (${totalSlips}) no coincide con el número real de <T4Slip> (${slipSections.length}).`,
    );
  }

  base.valid = base.errors.length === 0;
  return base;
}

/**
 * Valida un XML de T4A contra el schema CRA T4A.
 *
 * Verifica estructura T4A, presencia de Payer, Recipient, boxes T4A
 * (016, 020, 022, 028, 048), y que al menos un box de ingreso tenga
 * valor > 0 (un T4A sin ingresos no tiene sentido).
 *
 * @param xml — String XML del T4A submission.
 * @returns TaxXmlValidationResult con errores y advertencias.
 *
 * @example
 * ```ts
 * const result = validateT4AXml(t4aXml);
 * if (!result.valid) {
 *   console.error("T4A XML inválido:", result.errors);
 * }
 * ```
 */
export function validateT4AXml(xml: string): TaxXmlValidationResult {
  const base = validateXmlAgainstSchema(xml, XSD_SCHEMAS.T4A);

  // ── T4A-specific validations ────────────────────────────────────────────

  // At least one income box must have a non-zero value
  const incomeBoxes = ["Box016", "Box020", "Box028", "Box048"];
  const boxValues = incomeBoxes.map((box) => {
    const val = extractElementContent(xml, box);
    return val !== null ? parseFloat(val) : 0;
  });

  const totalIncome = boxValues.reduce((a, b) => a + b, 0);
  if (totalIncome === 0) {
    base.errors.push(
      "T4A inválido: todos los boxes de ingreso (Box016, Box020, Box028, Box048) tienen valor 0. " +
      "Un T4A debe reportar al menos un tipo de ingreso > $0.",
    );
  }

  // Income tax deducted (Box022) should reasonably relate to income
  const box022 = extractElementContent(xml, "Box022");
  if (box022 && parseFloat(box022) > 0 && totalIncome === 0) {
    base.warnings.push(
      "Box022 (income tax deducted) tiene valor pero no hay ingresos reportados en ningún box.",
    );
  }

  // Recipient identifier format check
  const recipientId = extractElementContent(xml, "RecipientIdentifier");
  if (recipientId) {
    const cleaned = recipientId.replace(/\s|-/g, "");
    if (!/^\d{9}(RT\d{4}|RP\d{4}|$)/.test(cleaned)) {
      base.errors.push(
        `RecipientIdentifier "${recipientId}" no es un BN (9 dígitos + RT/RP + 0001) ni SIN (9 dígitos) válido.`,
      );
    }
  }

  base.valid = base.errors.length === 0;
  return base;
}

/**
 * Valida un XML de ROE contra el schema de Service Canada ROE Web.
 *
 * Verifica estructura del Record of Employment, presencia de todos los
 * bloques requeridos (Employer, Employee, termination dates, insurable
 * earnings/hours), códigos de terminación válidos, y consistencia de fechas.
 *
 * @param xml — String XML del ROE generado por generateRoeXml().
 * @returns TaxXmlValidationResult con errores y advertencias.
 *
 * @example
 * ```ts
 * const result = validateRoeXml(roeXml);
 * if (!result.valid) {
 *   console.error("ROE XML inválido:", result.errors);
 * }
 * ```
 */
export function validateRoeXml(xml: string): TaxXmlValidationResult {
  const base = validateXmlAgainstSchema(xml, XSD_SCHEMAS.ROE);

  // ── ROE-specific cross-field validations ────────────────────────────────

  // Termination code must be one of the valid Service Canada codes
  const validCodes = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "M", "N", "P", "Z"];
  const termCode = extractElementContent(xml, "TerminationCode");
  if (termCode && !validCodes.includes(termCode.toUpperCase())) {
    base.errors.push(
      `TerminationCode "${termCode}" no es un código Service Canada válido. Códigos válidos: ${validCodes.join(", ")}.`,
    );
  }

  // Date consistency: firstDayWorked < lastDayWorked <= terminationDate
  const firstDay = extractElementContent(xml, "FirstDayWorked");
  const lastDay = extractElementContent(xml, "LastDayWorked");
  const termDate = extractElementContent(xml, "TerminationDate");

  if (firstDay && lastDay && firstDay > lastDay) {
    base.errors.push(
      `FirstDayWorked (${firstDay}) es posterior a LastDayWorked (${lastDay}).`,
    );
  }

  if (lastDay && termDate && lastDay > termDate) {
    base.errors.push(
      `LastDayWorked (${lastDay}) es posterior a TerminationDate (${termDate}).`,
    );
  }

  // Final pay period must be within employment dates
  const ppStart = extractElementContent(xml, "FinalPayPeriodStart");
  const ppEnd = extractElementContent(xml, "FinalPayPeriodEnd");

  if (ppStart && ppEnd && ppStart > ppEnd) {
    base.errors.push(
      `FinalPayPeriodStart (${ppStart}) es posterior a FinalPayPeriodEnd (${ppEnd}).`,
    );
  }

  // Insurable earnings and hours should be positive when there's employment
  const finalEarnings = extractElementContent(xml, "FinalPeriodInsurableEarnings");
  const finalHours = extractElementContent(xml, "FinalPeriodInsurableHours");
  const totalEarnings = extractElementContent(xml, "TotalInsurableEarnings");
  const totalHours = extractElementContent(xml, "TotalInsurableHours");

  if (finalEarnings && parseFloat(finalEarnings) < 0) {
    base.errors.push("FinalPeriodInsurableEarnings no puede ser negativo.");
  }
  if (finalHours && parseFloat(finalHours) < 0) {
    base.errors.push("FinalPeriodInsurableHours no puede ser negativo.");
  }
  if (totalEarnings && parseFloat(totalEarnings) < 0) {
    base.errors.push("TotalInsurableEarnings no puede ser negativo.");
  }
  if (totalHours && parseFloat(totalHours) < 0) {
    base.errors.push("TotalInsurableHours no puede ser negativo.");
  }

  // Total should be >= final period
  if (totalEarnings && finalEarnings && parseFloat(totalEarnings) < parseFloat(finalEarnings)) {
    base.errors.push(
      "TotalInsurableEarnings no puede ser menor que FinalPeriodInsurableEarnings.",
    );
  }
  if (totalHours && finalHours && parseFloat(totalHours) < parseFloat(finalHours)) {
    base.errors.push(
      "TotalInsurableHours no puede ser menor que FinalPeriodInsurableHours.",
    );
  }

  base.valid = base.errors.length === 0;
  return base;
}

// =========================================================================
// Schema Loader
// =========================================================================

/**
 * Devuelve la definición del schema XSD para un tipo de formulario fiscal.
 *
 * Esta función no carga archivos XSD reales del filesystem (requeriría
 * un parser XSD externo como libxmljs), sino que devuelve la definición
 * programática del schema con las reglas de validación aplicables.
 *
 * Usar esta función para:
 *   - Inspeccionar qué elementos son requeridos/opcionales para un formulario.
 *   - Obtener la referencia al schema oficial de CRA.
 *   - Validar programáticamente que un XML cumple con el schema esperado.
 *
 * @param formType — Tipo de formulario fiscal ("GST", "T4", "T4A", "ROE").
 * @returns XsdSchemaDefinition con las reglas de validación del schema.
 * @throws Error si el formType no es soportado.
 *
 * @example
 * ```ts
 * const schema = getXsdSchema("T4");
 * console.log("Elementos requeridos:", schema.requiredElements);
 * console.log("Referencia CRA:", schema.craReference);
 * ```
 */
export function getXsdSchema(formType: FormType): XsdSchemaDefinition {
  const schema = XSD_SCHEMAS[formType];
  if (!schema) {
    throw new Error(
      `FormType "${formType}" no soportado. Usar: GST, T4, T4A, o ROE.`,
    );
  }
  return { ...schema };
}

/**
 * Lista de todos los tipos de formulario fiscal soportados.
 */
export function getSupportedFormTypes(): FormType[] {
  return ["GST", "T4", "T4A", "ROE"];
}

// =========================================================================
// Internal helpers
// =========================================================================

/**
 * Extrae el valor numérico del contenido de un elemento.
 * @returns number o null si no se encuentra o no es parseable.
 */
function extractValue(xml: string, tagName: string): number | null {
  const content = extractElementContent(xml, tagName);
  if (content === null) return null;
  const num = parseFloat(content);
  return isNaN(num) ? null : num;
}

/**
 * Extrae todos los valores numéricos de un box en slips T4.
 * Busca dentro de los <T4Slip>...</T4Slip>.
 */
function extractAllBoxValues(xml: string, boxName: string): number[] {
  const regex = new RegExp(`<${escapeRegex(boxName)}>([\\d.]+)<\\/${escapeRegex(boxName)}>`, "gi");
  const values: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const num = parseFloat(match[1]);
    if (!isNaN(num)) values.push(num);
  }
  return values;
}
