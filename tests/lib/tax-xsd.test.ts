/**
 * Tests para los validadores fiscales del Año 2:
 *   - tax-xsd-validator.ts (validación XML/XSD)
 *   - tax-edge-cases.ts (validación de formatos y edge cases)
 *
 * Ejecutar con: npx tsx --test tests/lib/tax-xsd.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── XSD Validators ────────────────────────────────────────────────────────
import {
  validateGstXml,
  validateT4Xml,
  validateT4AXml,
  validateRoeXml,
  getXsdSchema,
  getSupportedFormTypes,
  type TaxXmlValidationResult,
  type FormType,
} from "../../src/lib/tax-xsd-validator";

// ── Edge Cases ────────────────────────────────────────────────────────────
import {
  calculateGstOnPartialPeriods,
  validateBusinessNumber,
  validateSinFormat,
  validateRoeReasonCode,
  validateT4BoxConstraints,
  getValidRoeReasonCodes,
  type T4BoxData,
} from "../../src/lib/tax-edge-cases";

// =========================================================================
// Synthetic XML generators (pure, no DB/external deps)
// =========================================================================

/**
 * Genera un XML de GST/HST Return válido para testing.
 */
function buildValidGstXml(overrides?: Partial<{
  bn: string;
  periodStart: string;
  periodEnd: string;
  gstCollected: number;
  itc: number;
  totalSales: number;
}>): string {
  const p = {
    bn: "123456789RT0001",
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    gstCollected: 5000.00,
    itc: 2000.00,
    totalSales: 100000.00,
    ...overrides,
  };

  const netTax = (p.gstCollected - p.itc).toFixed(2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<GSTHSTReturn
  xmlns="http://www.cra-arc.gc.ca/gncy/bn"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  returnType="Original"
  referencePeriod="2026-Q2"
  generatedDate="2026-07-15">
  <TransmissionHeader>
    <TransmissionID>TX-2026Q2-${Date.now()}</TransmissionID>
    <TransmissionDate>2026-07-15</TransmissionDate>
    <TransmitterSoftwareCode>LULUISLAND-TEST</TransmitterSoftwareCode>
    <TransmitterSoftwareVersion>1.0.0</TransmitterSoftwareVersion>
  </TransmissionHeader>
  <RegistrantInformation>
    <BusinessNumber>${p.bn}</BusinessNumber>
    <LegalName>Lulu Island Flagship Services Inc.</LegalName>
    <OperatingName>Lulu Island Flagship</OperatingName>
  </RegistrantInformation>
  <ReportingPeriod>
    <FiscalPeriodStart>${p.periodStart}</FiscalPeriodStart>
    <FiscalPeriodEnd>${p.periodEnd}</FiscalPeriodEnd>
  </ReportingPeriod>
  <ReturnData>
    <TotalSales>${p.totalSales.toFixed(2)}</TotalSales>
    <GSTCollected>${p.gstCollected.toFixed(2)}</GSTCollected>
    <InputTaxCredits>${p.itc.toFixed(2)}</InputTaxCredits>
    <NetTax>${netTax}</NetTax>
    <InstallmentPayments>0.00</InstallmentPayments>
    <Rebates>0.00</Rebates>
    <TaxWithheld>0.00</TaxWithheld>
  </ReturnData>
</GSTHSTReturn>`;
}

/**
 * Genera un XML de T4 Submission válido para testing.
 */
function buildValidT4Xml(overrides?: Partial<{
  slips: Array<{
    sin: string;
    box14: number;
    box16: number;
    box18: number;
    box22: number;
    box24: number;
    box26: number;
  }>;
  totalSlips: number;
}>): string {
  const slips = overrides?.slips ?? [
    { sin: "*** *** 789", box14: 45000.00, box16: 2500.00, box18: 733.50, box22: 8000.00, box24: 45000.00, box26: 45000.00 },
    { sin: "*** *** 456", box14: 32000.00, box16: 1800.00, box18: 521.60, box22: 5500.00, box24: 32000.00, box26: 32000.00 },
  ];

  const totalIncome = slips.reduce((s, slip) => s + slip.box14, 0).toFixed(2);
  const totalTax = slips.reduce((s, slip) => s + slip.box22, 0).toFixed(2);
  const declaredSlips = overrides?.totalSlips ?? slips.length;

  let slipXml = "";
  for (const slip of slips) {
    slipXml += `
    <T4Slip>
      <Employee>
        <SIN>${slip.sin}</SIN>
        <LegalName>Test Employee</LegalName>
        <AddressLine1>123 Test St</AddressLine1>
        <City>Vancouver</City>
        <Province>BC</Province>
        <PostalCode>V6B 1A1</PostalCode>
      </Employee>
      <Box14>${slip.box14.toFixed(2)}</Box14>
      <Box16>${slip.box16.toFixed(2)}</Box16>
      <Box18>${slip.box18.toFixed(2)}</Box18>
      <Box22>${slip.box22.toFixed(2)}</Box22>
      <Box24>${slip.box24.toFixed(2)}</Box24>
      <Box26>${slip.box26.toFixed(2)}</Box26>
    </T4Slip>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<T619 xmlns="http://www.cra-arc.gc.ca/xml/t619/2026"
  submissionReferenceID="T4-2026-O-${Date.now()}"
  taxYear="2026"
  transmissionType="O">
  <Transmitter>
    <BusinessNumber>123456789RP0001</BusinessNumber>
    <GeneratedDate>2026-02-28</GeneratedDate>
    <GeneratedTimestamp>2026-02-28T10:00:00.000Z</GeneratedTimestamp>
    <SoftwareVendor>Lulu Island Flagship — Test</SoftwareVendor>
    <TotalSlips>${declaredSlips}</TotalSlips>
    <TotalIncome>${totalIncome}</TotalIncome>
    <TotalTaxDeducted>${totalTax}</TotalTaxDeducted>
  </Transmitter>
  <Return>
    <Employer>
      <BusinessNumber>123456789RP0001</BusinessNumber>
      <LegalName>Lulu Island Flagship Services Inc.</LegalName>
      <OperatingName>Lulu Island Flagship</OperatingName>
      <AddressLine1>1231 Pacific Blvd</AddressLine1>
      <City>Vancouver</City>
      <Province>BC</Province>
      <PostalCode>V6Z 0E2</PostalCode>
      <Country>CA</Country>
    </Employer>${slipXml}
    <T4Summary>
      <TotalSlips>${declaredSlips}</TotalSlips>
      <TotalIncome>${totalIncome}</TotalIncome>
      <TotalTaxDeducted>${totalTax}</TotalTaxDeducted>
    </T4Summary>
  </Return>
</T619>`;
}

/**
 * Genera un XML de T4A válido para testing.
 */
function buildValidT4AXml(overrides?: Partial<{
  box016: number;
  box020: number;
  box028: number;
  box048: number;
  box022: number;
  recipientId: string;
}>): string {
  const p = {
    box016: 0,
    box020: 15000.00,
    box028: 0,
    box048: 5000.00,
    box022: 0,
    recipientId: "123456789",
    ...overrides,
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<T4ASubmission
  xmlns="http://www.cra-arc.gc.ca/xml/t619/2026"
  taxYear="2026"
  submissionID="T4A-2026-${Date.now()}">
  <TaxYear>2026</TaxYear>
  <Payer>
    <PayerLegalName>Lulu Island Flagship Services Inc.</PayerLegalName>
    <PayerBN>123456789RP0001</PayerBN>
    <PayerOperatingName>Lulu Island Flagship</PayerOperatingName>
  </Payer>
  <Recipient>
    <RecipientName>Partner Test Inc.</RecipientName>
    <RecipientIdentifier>${p.recipientId}</RecipientIdentifier>
    <AddressLine1>456 Partner Ave</AddressLine1>
    <City>Richmond</City>
    <Province>BC</Province>
    <PostalCode>V7E 2B3</PostalCode>
  </Recipient>
  <T4ABoxes>
    <Box016>${p.box016.toFixed(2)}</Box016>
    <Box020>${p.box020.toFixed(2)}</Box020>
    <Box022>${p.box022.toFixed(2)}</Box022>
    <Box028>${p.box028.toFixed(2)}</Box028>
    <Box048>${p.box048.toFixed(2)}</Box048>
  </T4ABoxes>
</T4ASubmission>`;
}

/**
 * Genera un XML de ROE válido para testing.
 */
function buildValidRoeXml(overrides?: Partial<{
  terminationCode: string;
  firstDay: string;
  lastDay: string;
  terminationDate: string;
  finalEarnings: number;
  finalHours: number;
  totalEarnings: number;
  totalHours: number;
  ppStart: string;
  ppEnd: string;
  serialNumber: string;
}>): string {
  const p = {
    terminationCode: "A",
    firstDay: "2025-03-01",
    lastDay: "2026-06-15",
    terminationDate: "2026-06-15",
    finalEarnings: 2500.00,
    finalHours: 80,
    totalEarnings: 52000.00,
    totalHours: 1664,
    ppStart: "2026-06-01",
    ppEnd: "2026-06-15",
    serialNumber: "ROE-ABC123-2026",
    ...overrides,
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<RecordOfEmployment
  xmlns="http://www.servicecanada.gc.ca/xml/roe/2026"
  serialNumber="${p.serialNumber}"
  generatedDate="2026-06-20">
  <SerialNumber>${p.serialNumber}</SerialNumber>
  <Employer>
    <EmployerLegalName>Lulu Island Flagship Services Inc.</EmployerLegalName>
    <EmployerBN>123456789RP0001</EmployerBN>
    <EmployerOperatingName>Lulu Island Flagship</EmployerOperatingName>
  </Employer>
  <Employee>
    <EmployeeLegalName>John Doe</EmployeeLegalName>
    <SIN>*** *** 789</SIN>
    <AddressLine1>789 Worker St</AddressLine1>
    <City>Vancouver</City>
    <Province>BC</Province>
    <PostalCode>V5K 0A1</PostalCode>
  </Employee>
  <FirstDayWorked>${p.firstDay}</FirstDayWorked>
  <LastDayWorked>${p.lastDay}</LastDayWorked>
  <TerminationDate>${p.terminationDate}</TerminationDate>
  <TerminationCode>${p.terminationCode}</TerminationCode>
  <FinalPayPeriodStart>${p.ppStart}</FinalPayPeriodStart>
  <FinalPayPeriodEnd>${p.ppEnd}</FinalPayPeriodEnd>
  <FinalPeriodInsurableEarnings>${p.finalEarnings.toFixed(2)}</FinalPeriodInsurableEarnings>
  <FinalPeriodInsurableHours>${p.finalHours}</FinalPeriodInsurableHours>
  <TotalInsurableEarnings>${p.totalEarnings.toFixed(2)}</TotalInsurableEarnings>
  <TotalInsurableHours>${p.totalHours}</TotalInsurableHours>
  <PayPeriodCount>26</PayPeriodCount>
</RecordOfEmployment>`;
}

// =========================================================================
// 1. GST XML Validation Tests
// =========================================================================

describe("validateGstXml", () => {
  it("debe validar un GST XML correcto (NETFILE CRA)", () => {
    const xml = buildValidGstXml();
    const result = validateGstXml(xml);

    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
    assert.equal(result.formType, "GST");
    assert.ok(result.errors.length === 0, "No debe haber errores");
    assert.ok(typeof result.validatedAt === "string");
  });

  it("debe rechazar XML sin declaración XML", () => {
    const xml = buildValidGstXml().replace('<?xml version="1.0" encoding="UTF-8"?>', "");
    const result = validateGstXml(xml);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.toLowerCase().includes("declaración xml")));
  });

  it("debe rechazar XML sin BusinessNumber", () => {
    const xml = buildValidGstXml().replace(/<BusinessNumber>.*?<\/BusinessNumber>/, "");
    const result = validateGstXml(xml);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("BusinessNumber")));
  });

  it("debe rechazar XML con formato BN inválido", () => {
    const xml = buildValidGstXml({ bn: "12345" });
    const result = validateGstXml(xml);
    // Should have a pattern error on the BN value
    assert.ok(result.errors.some((e) => e.includes("BusinessNumber")));
  });

  it("debe rechazar XML sin GSTCollected", () => {
    const xml = buildValidGstXml().replace(/<GSTCollected>.*?<\/GSTCollected>/, "");
    const result = validateGstXml(xml);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("GSTCollected")));
  });

  it("debe rechazar XML sin InputTaxCredits", () => {
    const xml = buildValidGstXml().replace(/<InputTaxCredits>.*?<\/InputTaxCredits>/, "");
    const result = validateGstXml(xml);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("InputTaxCredits")));
  });

  it("debe detectar inconsistencia en NetTax vs GSTCollected - ITCs", () => {
    const xml = buildValidGstXml({ gstCollected: 5000, itc: 2000 });
    // Corrupt the NetTax to not match
    const corrupted = xml.replace(/<NetTax>3000\.00<\/NetTax>/, "<NetTax>9999.00</NetTax>");
    const result = validateGstXml(corrupted);
    assert.ok(
      result.errors.some((e) => e.includes("NetTax") && e.includes("no cuadra")),
      `Esperado error de NetTax inconsistente. Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe detectar período fiscal con fechas invertidas", () => {
    const xml = buildValidGstXml({ periodStart: "2026-06-30", periodEnd: "2026-04-01" });
    const result = validateGstXml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("FiscalPeriodStart") && e.includes("posterior")),
    );
  });

  it("debe aceptar GST zero return (empresa sin actividad)", () => {
    const xml = buildValidGstXml({
      gstCollected: 0,
      itc: 0,
      totalSales: 0,
    });
    // Fix NetTax
    const fixed = xml.replace(/<NetTax>.*?<\/NetTax>/, "<NetTax>0.00</NetTax>");
    const result = validateGstXml(fixed);
    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
  });
});

// =========================================================================
// 2. T4 XML Validation Tests
// =========================================================================

describe("validateT4Xml", () => {
  it("debe validar un T4 XML correcto (CRA T619)", () => {
    const xml = buildValidT4Xml();
    const result = validateT4Xml(xml);

    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
    assert.equal(result.formType, "T4");
    assert.ok(result.errors.length === 0);
  });

  it("debe rechazar XML sin elemento raíz T619", () => {
    const badXml = buildValidT4Xml().replace(/<T619/g, "<WrongRoot").replace(/<\/T619>/g, "</WrongRoot>");
    const result = validateT4Xml(badXml);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("T619")));
  });

  it("debe rechazar XML sin T4Summary", () => {
    const badXml = buildValidT4Xml().replace(/<T4Summary>[\s\S]*?<\/T4Summary>/g, "");
    const result = validateT4Xml(badXml);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("T4Summary")));
  });

  it("debe detectar T4Slip sin boxes obligatorios", () => {
    // Remove Box14 from all slips
    const badXml = buildValidT4Xml().replace(/<Box14>[\d.]+<\/Box14>/g, "");
    const result = validateT4Xml(badXml);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Box14")));
  });

  it("debe rechazar SIN con formato inválido en T4Slip", () => {
    const xml = buildValidT4Xml({
      slips: [
        { sin: "INVALID-SIN", box14: 45000, box16: 2500, box18: 733.50, box22: 8000, box24: 45000, box26: 45000 },
      ],
    });
    const result = validateT4Xml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("SIN") && e.includes("formato")),
      `Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe detectar Box26 mayor que Box14", () => {
    const xml = buildValidT4Xml({
      slips: [
        { sin: "*** *** 789", box14: 30000, box16: 2500, box18: 733.50, box22: 5000, box24: 30000, box26: 50000 },
      ],
    });
    const result = validateT4Xml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("Box26") && e.includes("excede")),
      `Esperado error de Box26 > Box14. Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe detectar TotalSlips que no coincide con número real de slips", () => {
    const xml = buildValidT4Xml({ totalSlips: 99 });
    const result = validateT4Xml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("TotalSlips") && e.includes("coincide")),
    );
  });

  it("debe detectar TotalIncome que no cuadra con suma de Box14", () => {
    const xml = buildValidT4Xml();
    // Corrupt TotalIncome in T4Summary
    const badXml = xml.replace(/<TotalIncome>[\d.]+<\/TotalIncome>/, "<TotalIncome>999999.99</TotalIncome>");
    const result = validateT4Xml(badXml);
    assert.ok(
      result.errors.some((e) => e.includes("TotalIncome") && e.includes("no cuadra")),
    );
  });

  it("debe advertir si no hay T4Slips", () => {
    const xml = buildValidT4Xml().replace(/<T4Slip>[\s\S]*?<\/T4Slip>/g, "");
    const result = validateT4Xml(xml);
    assert.ok(
      result.warnings.some((w) => w.includes("No se encontraron") || w.includes("T4Slip")),
      `Warnings: ${result.warnings.join("; ")}`,
    );
  });

  it("debe detectar Box18 con valor pero Box24 en cero", () => {
    const xml = buildValidT4Xml({
      slips: [
        { sin: "*** *** 789", box14: 45000, box16: 2500, box18: 733.50, box22: 8000, box24: 0, box26: 45000 },
      ],
    });
    const result = validateT4Xml(xml);
    assert.ok(
      result.warnings.some((w) => w.includes("Box18") && w.includes("Box24")),
      `Warnings: ${result.warnings.join("; ")}`,
    );
  });
});

// =========================================================================
// 3. T4A XML Validation Tests
// =========================================================================

describe("validateT4AXml", () => {
  it("debe validar un T4A XML correcto", () => {
    const xml = buildValidT4AXml();
    const result = validateT4AXml(xml);

    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
    assert.equal(result.formType, "T4A");
    assert.ok(result.errors.length === 0);
  });

  it("debe rechazar T4A con todos los boxes de ingreso en cero", () => {
    const xml = buildValidT4AXml({
      box020: 0,
      box048: 0,
      box016: 0,
      box028: 0,
    });
    const result = validateT4AXml(xml);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.toLowerCase().includes("boxes") && e.includes("0")),
      `Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe rechazar T4A con RecipientIdentifier inválido", () => {
    const xml = buildValidT4AXml({ recipientId: "XYZ-123" });
    const result = validateT4AXml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("RecipientIdentifier")),
      `Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe aceptar T4A con solo Box048 (fees for services)", () => {
    const xml = buildValidT4AXml({ box020: 0, box048: 3500.00, box016: 0, box028: 0 });
    const result = validateT4AXml(xml);
    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
  });

  it("debe advertir si Box022 > 0 pero sin ingresos", () => {
    const xml = buildValidT4AXml({
      box020: 0, box048: 0, box016: 0, box028: 0, box022: 500.00,
    });
    const result = validateT4AXml(xml);
    assert.ok(
      result.warnings.some((w) => w.includes("Box022")),
      `Warnings: ${result.warnings.join("; ")}`,
    );
  });

  it("debe aceptar T4A con BN de 15 caracteres como RecipientIdentifier", () => {
    const xml = buildValidT4AXml({ recipientId: "987654321RT0001" });
    const result = validateT4AXml(xml);
    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
  });
});

// =========================================================================
// 4. ROE XML Validation Tests
// =========================================================================

describe("validateRoeXml", () => {
  it("debe validar un ROE XML correcto", () => {
    const xml = buildValidRoeXml();
    const result = validateRoeXml(xml);

    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
    assert.equal(result.formType, "ROE");
    assert.ok(result.errors.length === 0);
  });

  it("debe rechazar ROE con código de terminación inválido", () => {
    const xml = buildValidRoeXml({ terminationCode: "X" });
    const result = validateRoeXml(xml);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.toLowerCase().includes("terminationcode")),
      `Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe rechazar ROE con fechas inconsistentes (firstDay > lastDay)", () => {
    const xml = buildValidRoeXml({
      firstDay: "2026-12-01",
      lastDay: "2026-01-15",
      terminationDate: "2026-12-15",
    });
    const result = validateRoeXml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("FirstDayWorked") && e.includes("posterior")),
      `Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe rechazar ROE con lastDay posterior a terminationDate", () => {
    const xml = buildValidRoeXml({
      firstDay: "2025-01-01",
      lastDay: "2026-12-31",
      terminationDate: "2026-06-15",
    });
    const result = validateRoeXml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("LastDayWorked") && e.includes("posterior")),
      `Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe rechazar ROE con período de pago final inconsistente (start > end)", () => {
    const xml = buildValidRoeXml({
      ppStart: "2026-06-30",
      ppEnd: "2026-06-01",
    });
    const result = validateRoeXml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("FinalPayPeriodStart") && e.includes("posterior")),
    );
  });

  it("debe rechazar ROE con insurable earnings negativos", () => {
    const xml = buildValidRoeXml({ finalEarnings: -500 });
    const result = validateRoeXml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("negativo")),
      `Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe detectar total earnings menor que final period earnings", () => {
    const xml = buildValidRoeXml({
      finalEarnings: 50000.00,
      totalEarnings: 2500.00, // menor que el período final
    });
    const result = validateRoeXml(xml);
    assert.ok(
      result.errors.some((e) => e.includes("TotalInsurableEarnings")),
      `Errores: ${result.errors.join("; ")}`,
    );
  });

  it("debe aceptar todos los códigos de terminación válidos", () => {
    const validCodes = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "M", "N", "P", "Z"];
    for (const code of validCodes) {
      const xml = buildValidRoeXml({ terminationCode: code });
      const result = validateRoeXml(xml);
      assert.equal(
        result.valid,
        true,
        `Código "${code}" debería ser válido. Errores: ${result.errors.join("; ")}`,
      );
    }
  });
});

// =========================================================================
// 5. XSD Schema Loader Tests
// =========================================================================

describe("getXsdSchema", () => {
  it("debe devolver schema para GST", () => {
    const schema = getXsdSchema("GST");
    assert.equal(schema.formType, "GST");
    assert.equal(schema.rootElement, "GSTHSTReturn");
    assert.ok(schema.requiredElements.includes("BusinessNumber"));
    assert.ok(schema.requiredElements.includes("GSTCollected"));
    assert.ok(schema.fieldPatterns.BusinessNumber);
  });

  it("debe devolver schema para T4", () => {
    const schema = getXsdSchema("T4");
    assert.equal(schema.formType, "T4");
    assert.equal(schema.rootElement, "T619");
    assert.ok(schema.requiredElements.includes("Employer"));
    assert.ok(schema.requiredElements.includes("T4Summary"));
    assert.ok(schema.fieldPatterns.SIN);
  });

  it("debe devolver schema para T4A", () => {
    const schema = getXsdSchema("T4A");
    assert.equal(schema.formType, "T4A");
    assert.ok(schema.requiredElements.includes("Payer"));
    assert.ok(schema.requiredElements.includes("Recipient"));
  });

  it("debe devolver schema para ROE", () => {
    const schema = getXsdSchema("ROE");
    assert.equal(schema.formType, "ROE");
    assert.ok(schema.requiredElements.includes("TerminationCode"));
    assert.ok(schema.requiredElements.includes("TotalInsurableEarnings"));
    assert.ok(schema.fieldPatterns.TerminationCode);
  });

  it("debe lanzar error para formType no soportado", () => {
    assert.throws(
      () => getXsdSchema("INVALID" as FormType),
      /no soportado/,
    );
  });
});

describe("getSupportedFormTypes", () => {
  it("debe devolver los 4 tipos de formulario", () => {
    const types = getSupportedFormTypes();
    assert.deepEqual(types, ["GST", "T4", "T4A", "ROE"]);
  });
});

// =========================================================================
// 6. Edge Case: Business Number Validation
// =========================================================================

describe("validateBusinessNumber", () => {
  it("debe validar un BN GST correcto (RT)", () => {
    const result = validateBusinessNumber("123456789RT0001");
    assert.equal(result.valid, true);
    assert.equal(result.root, "123456789");
    assert.equal(result.programCode, "RT");
    assert.equal(result.accountNumber, "0001");
    assert.equal(result.normalized, "123456789RT0001");
  });

  it("debe validar un BN Payroll correcto (RP)", () => {
    const result = validateBusinessNumber("987654321RP0001");
    assert.equal(result.valid, true);
    assert.equal(result.programCode, "RP");
  });

  it("debe validar un BN Corporate correcto (RC)", () => {
    const result = validateBusinessNumber("111222333RC0002");
    assert.equal(result.valid, true);
    assert.equal(result.programCode, "RC");
  });

  it("debe rechazar BN con longitud incorrecta", () => {
    const result = validateBusinessNumber("123456789RT");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("15 caracteres")));
  });

  it("debe rechazar BN con código de programa inválido", () => {
    const result = validateBusinessNumber("123456789XX0001");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("programa")));
  });

  it("debe rechazar BN con raíz no numérica", () => {
    const result = validateBusinessNumber("ABCDEFGHIRT0001");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Raíz")));
  });

  it("debe rechazar BN con número de cuenta no numérico", () => {
    const result = validateBusinessNumber("123456789RTABCD");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("cuenta")));
  });

  it("debe normalizar BN con espacios y guiones", () => {
    const result = validateBusinessNumber("12345 6789 RT 0001");
    assert.equal(result.valid, true);
    assert.equal(result.normalized, "123456789RT0001");
  });

  it("debe rechazar BN vacío", () => {
    const result = validateBusinessNumber("");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("vacío")));
  });
});

// =========================================================================
// 7. Edge Case: SIN Format Validation
// =========================================================================

describe("validateSinFormat", () => {
  it("debe validar un SIN correcto con checksum de Luhn", () => {
    // SIN: 046 454 286 — Luhn-valid (ficticio)
    const result = validateSinFormat("046454286");
    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
    assert.equal(result.normalized, "046454286");
    assert.equal(result.masked, "*** *** 286");
    assert.equal(result.luhnValid, true);
    assert.ok(result.region.length > 0, `Región: ${result.region}`);
  });

  it("debe rechazar SIN con checksum de Luhn inválido", () => {
    const result = validateSinFormat("123456789");
    assert.equal(result.valid, false);
    assert.equal(result.luhnValid, false);
    assert.ok(result.errors.some((e) => e.includes("Luhn")));
  });

  it("debe rechazar SIN que empieza con 0", () => {
    const result = validateSinFormat("012345678");
    // 012345678 fails Luhn checksum
    assert.equal(result.luhnValid, false);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Luhn")));
  });

  it("debe rechazar SIN que empieza con 8", () => {
    const result = validateSinFormat("812345679");
    assert.ok(result.errors.some((e) => e.includes("8")));
  });

  it("debe rechazar SIN con longitud incorrecta", () => {
    const result = validateSinFormat("12345");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("9 dígitos")));
  });

  it("debe rechazar SIN con caracteres no numéricos", () => {
    const result = validateSinFormat("ABC456789");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("no numéricos")));
  });

  it("debe aceptar SIN enmascarado (*** *** 789)", () => {
    const result = validateSinFormat("*** *** 789");
    assert.equal(result.valid, true);
    assert.equal(result.masked, "*** *** 789");
    assert.ok(result.region.includes("Enmascarado"));
  });

  it("debe aceptar SIN con espacios (046 454 286)", () => {
    const result = validateSinFormat("046 454 286");
    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
    assert.equal(result.normalized, "046454286");
    assert.equal(result.luhnValid, true);
  });

  it("debe rechazar SIN enmascarado con formato incorrecto", () => {
    const result = validateSinFormat("*** ** 79");  // mal formato
    assert.equal(result.valid, false);
  });
});

// =========================================================================
// 8. Edge Case: ROE Reason Code Validation
// =========================================================================

describe("validateRoeReasonCode", () => {
  it("debe validar todos los códigos ROE Service Canada", () => {
    const codes = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "M", "N", "P", "Z"];
    for (const code of codes) {
      const result = validateRoeReasonCode(code);
      assert.equal(result.valid, true, `Código "${code}" debería ser válido.`);
      assert.ok(result.description);
    }
  });

  it("debe rechazar código ROE inválido", () => {
    const result = validateRoeReasonCode("X");
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("no es un código ROE válido"));
  });

  it("debe rechazar código ROE de más de un carácter", () => {
    const result = validateRoeReasonCode("AA");
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("exactamente una letra"));
  });

  it("debe normalizar a mayúsculas", () => {
    const result = validateRoeReasonCode("a");
    assert.equal(result.valid, true);
    assert.equal(result.code, "A");
  });

  it("debe manejar espacios en blanco", () => {
    const result = validateRoeReasonCode("  A  ");
    assert.equal(result.valid, true);
    assert.equal(result.code, "A");
  });
});

describe("getValidRoeReasonCodes", () => {
  it("debe devolver 14 códigos con descripciones", () => {
    const codes = getValidRoeReasonCodes();
    assert.equal(codes.length, 14);
    assert.ok(codes.every((c) => c.code.length === 1 && c.description.length > 0));
  });
});

// =========================================================================
// 9. Edge Case: T4 Box Constraints
// =========================================================================

describe("validateT4BoxConstraints", () => {
  const validBoxes: T4BoxData = {
    box14: 45_000_00,
    box16: 2_500_00,
    box18: 733_50,
    box22: 8_000_00,
    box24: 45_000_00,
    box26: 45_000_00,
    taxYear: 2026,
  };

  it("debe validar un conjunto de boxes T4 correcto", () => {
    const result = validateT4BoxConstraints(validBoxes);
    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
    assert.ok(result.errors.length === 0);
  });

  it("debe rechazar Box26 > Box14", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box26: 50_000_00 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Box26") && e.includes("excede")));
  });

  it("debe rechazar Box24 > Box14", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box24: 50_000_00 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Box24") && e.includes("excede")));
  });

  it("debe rechazar Box26 > YMPE del año", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box26: 80_000_00, taxYear: 2026 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("YMPE")));
  });

  it("debe rechazar valores negativos en cualquier box", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box14: -100_00 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("negativo")));
  });

  it("debe rechazar Box16 > 0 con Box26 = 0", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box26: 0, box28: 0 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Box16") && e.includes("Box26")));
  });

  it("debe rechazar Box18 > 0 con Box24 = 0", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box24: 0, box28: 0 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Box18") && e.includes("Box24")));
  });

  it("debe rechazar Box28 (Exempt) con CPP/EI > 0", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box28: 1 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Exempt") || e.includes("Box28")));
  });

  it("debe rechazar Box44 (Union dues) > Box14", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box44: 50_000_00 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Box44")));
  });

  it("debe advertir si no hay tax retenido con ingreso > 0", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box22: 0 });
    assert.ok(result.warnings.some((w) => w.includes("Box22") && w.includes("Box14")));
  });

  it("debe advertir si RPP contributions sin pension adjustment", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box50: 5_000_00, box52: 0 });
    assert.ok(result.warnings.some((w) => w.includes("Box50") && w.includes("Box52")));
  });

  it("debe advertir tasa de retención inusualmente alta", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box22: 30_000_00, box14: 45_000_00 });
    assert.ok(result.warnings.some((w) => w.includes("retención") && w.includes("alta")));
  });

  it("debe advertir tasa de retención inusualmente baja", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box22: 100_00, box14: 50_000_00 });
    assert.ok(result.warnings.some((w) => w.includes("retención") && w.includes("baja")));
  });

  it("debe aceptar empleado exento con Box28 > 0 y CPP/EI = 0", () => {
    const exemptBoxes: T4BoxData = {
      box14: 20_000_00,
      box16: 0,
      box18: 0,
      box22: 1_000_00,
      box24: 0,
      box26: 0,
      box28: 20_000_00,
      taxYear: 2026,
    };
    const result = validateT4BoxConstraints(exemptBoxes);
    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
  });

  it("debe aceptar diferentes años fiscales con YMPE correspondiente", () => {
    const boxes2024: T4BoxData = {
      ...validBoxes,
      box14: 68_500_00, // >= YMPE 2024
      box24: 63_200_00, // = EI max 2024
      box26: 68_500_00, // = YMPE 2024
      taxYear: 2024,
    };
    const result = validateT4BoxConstraints(boxes2024);
    assert.equal(result.valid, true, `Errores: ${result.errors.join("; ")}`);
  });

  it("debe rechazar Box24 > EI máximo del año", () => {
    const result = validateT4BoxConstraints({ ...validBoxes, box24: 70_000_00, taxYear: 2026 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("máximo asegurable")));
  });
});

// =========================================================================
// 10. Edge Case: GST on Partial Periods
// =========================================================================

describe("calculateGstOnPartialPeriods", () => {
  it("debe calcular GST en período trimestral completo", () => {
    const result = calculateGstOnPartialPeriods(
      "2026-Q2", "2026-04-01", null, 5000_00, 2000_00,
    );
    assert.equal(result.isPartialPeriod, false);
    assert.equal(result.prorationFactor, 1);
    assert.equal(result.activeDays, 91); // Q2 = Apr+May+Jun = 30+31+30 = 91
  });

  it("debe detectar período parcial por alta a mitad de trimestre", () => {
    const result = calculateGstOnPartialPeriods(
      "2026-Q2", "2026-05-15", null, 3000_00, 1000_00,
    );
    assert.equal(result.isPartialPeriod, true);
    assert.ok(result.prorationFactor > 0 && result.prorationFactor < 1);
    assert.ok(result.activeDays < result.totalDaysInPeriod);
  });

  it("debe calcular GST en período parcial por baja fiscal", () => {
    const result = calculateGstOnPartialPeriods(
      "2026-Q3", "2026-07-01", "2026-08-15", 4000_00, 1500_00,
    );
    assert.equal(result.isPartialPeriod, true);
    assert.ok(result.activeDays < result.totalDaysInPeriod);
    assert.equal(result.isPartialPeriod, true);
  });

  it("debe manejar período mensual completo (YYYY-MM)", () => {
    const result = calculateGstOnPartialPeriods(
      "2026-08", "2026-08-01", null, 2000_00, 800_00,
    );
    assert.equal(result.isPartialPeriod, false);
    assert.equal(result.activeDays, 31);
    assert.equal(result.totalDaysInPeriod, 31);
  });

  it("debe calcular NetTax correcto para período parcial", () => {
    const result = calculateGstOnPartialPeriods(
      "2026-Q2", "2026-05-01", null, 10000_00, 4000_00,
    );
    assert.equal(result.gstCollectedActiveCents, 10000_00);
    assert.equal(result.gstItcActiveCents, 4000_00);
    // gstNetProRated ≈ (10000-4000) * prorationFactor
    const expectedNet = Math.round(6000_00 * result.prorationFactor);
    assert.equal(result.gstNetProRatedCents, expectedNet);
  });

  it("debe devolver prorationFactor 1 para período exacto", () => {
    const result = calculateGstOnPartialPeriods(
      "2026-01", "2026-01-01", "2026-01-31", 1000_00, 500_00,
    );
    assert.equal(result.isPartialPeriod, false);
    assert.equal(result.prorationFactor, 1);
    assert.equal(result.activeDays, 31);
  });

  it("debe lanzar error con formato de período inválido", () => {
    assert.throws(
      () => calculateGstOnPartialPeriods("INVALID", "2026-01-01", null, 1000_00, 500_00),
      /Formato de período inválido/,
    );
  });

  it("debe manejar operaciones que empiezan antes del período (clamp)", () => {
    const result = calculateGstOnPartialPeriods(
      "2026-Q2", "2026-01-01", null, 5000_00, 2000_00,
    );
    // operationsStart se clampa al inicio del período
    assert.equal(result.isPartialPeriod, false);
    assert.equal(result.activeDays, 91);
  });

  it("debe manejar operaciones que terminan después del período (clamp)", () => {
    const result = calculateGstOnPartialPeriods(
      "2026-Q2", "2026-04-01", "2026-12-31", 5000_00, 2000_00,
    );
    assert.equal(result.isPartialPeriod, false);
    assert.equal(result.activeDays, 91);
  });
});

// =========================================================================
// 11. Cross-validator integrity
// =========================================================================

describe("Cross-validator integrity", () => {
  it("todos los validadores deben devolver estructura consistente", () => {
    const validators = [
      { fn: validateGstXml, xml: buildValidGstXml(), name: "GST" },
      { fn: validateT4Xml, xml: buildValidT4Xml(), name: "T4" },
      { fn: validateT4AXml, xml: buildValidT4AXml(), name: "T4A" },
      { fn: validateRoeXml, xml: buildValidRoeXml(), name: "ROE" },
    ];

    for (const { fn, xml, name } of validators) {
      const result: TaxXmlValidationResult = fn(xml);
      assert.equal(typeof result.valid, "boolean", `${name}: valid debe ser boolean`);
      assert.ok(Array.isArray(result.errors), `${name}: errors debe ser array`);
      assert.ok(Array.isArray(result.warnings), `${name}: warnings debe ser array`);
      assert.ok(typeof result.formType === "string", `${name}: formType debe ser string`);
      assert.ok(typeof result.validatedAt === "string", `${name}: validatedAt debe ser string`);
      assert.ok(
        result.validatedAt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        `${name}: validatedAt debe ser ISO 8601`,
      );
    }
  });

  it("XML corrupto (no XML en absoluto) debe fallar en todos los validadores", () => {
    const garbage = "esto no es XML para nada";

    const gstResult = validateGstXml(garbage);
    assert.equal(gstResult.valid, false);

    const t4Result = validateT4Xml(garbage);
    assert.equal(t4Result.valid, false);

    const t4aResult = validateT4AXml(garbage);
    assert.equal(t4aResult.valid, false);

    const roeResult = validateRoeXml(garbage);
    assert.equal(roeResult.valid, false);
  });

  it("todos los schemas deben tener elementos requeridos", () => {
    for (const ft of getSupportedFormTypes()) {
      const schema = getXsdSchema(ft);
      assert.ok(schema.requiredElements.length > 0, `${ft}: debe tener requiredElements`);
      assert.ok(schema.rootElement.length > 0, `${ft}: debe tener rootElement`);
      assert.ok(schema.craReference.length > 0, `${ft}: debe tener craReference`);
    }
  });
});
