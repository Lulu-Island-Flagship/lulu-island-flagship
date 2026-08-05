/**
 * Quick debug script to isolate failing test behavior.
 * Run with: npx tsx tests/lib/debug-failing.ts
 */
import { validateT4Xml, validateT4AXml } from "../../src/lib/tax-xsd-validator";

// --- T4 Slip test reproduction ---
function buildTestT4() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<T619 xmlns="http://www.cra-arc.gc.ca/xml/t619/2026"
  submissionReferenceID="T4-2026-O-123"
  taxYear="2026"
  transmissionType="O">
  <Transmitter>
    <BusinessNumber>123456789RP0001</BusinessNumber>
    <GeneratedDate>2026-02-28</GeneratedDate>
    <GeneratedTimestamp>2026-02-28T10:00:00.000Z</GeneratedTimestamp>
    <SoftwareVendor>Test</SoftwareVendor>
    <TotalSlips>1</TotalSlips>
    <TotalIncome>45000.00</TotalIncome>
    <TotalTaxDeducted>8000.00</TotalTaxDeducted>
  </Transmitter>
  <Return>
    <Employer>
      <BusinessNumber>123456789RP0001</BusinessNumber>
      <LegalName>Test Inc.</LegalName>
      <OperatingName>Test</OperatingName>
      <AddressLine1>123 Main St</AddressLine1>
      <City>Vancouver</City>
      <Province>BC</Province>
      <PostalCode>V6Z 0E2</PostalCode>
      <Country>CA</Country>
    </Employer>
    <T4Slip>
      <Employee>
        <SIN>*** *** 789</SIN>
        <LegalName>Test Employee</LegalName>
        <AddressLine1>123 Test St</AddressLine1>
        <City>Vancouver</City>
        <Province>BC</Province>
        <PostalCode>V6B 1A1</PostalCode>
      </Employee>
      <Box14>45000.00</Box14>
      <Box16>2500.00</Box16>
      <Box18>733.50</Box18>
      <Box22>8000.00</Box22>
      <Box24>45000.00</Box24>
      <Box26>45000.00</Box26>
    </T4Slip>
    <T4Summary>
      <TotalSlips>1</TotalSlips>
      <TotalIncome>45000.00</TotalIncome>
      <TotalTaxDeducted>8000.00</TotalTaxDeducted>
    </T4Summary>
  </Return>
</T619>`;
}

const t4xml = buildTestT4();
const t4noBox14 = t4xml.replace(/<Box14>[\d.]+<\/Box14>/g, "");

console.log("=== T4: Removing Box14 ===");
console.log("Before replace has Box14:", t4xml.includes("<Box14>"));
console.log("After replace has Box14:", t4noBox14.includes("<Box14>"));

const t4result = validateT4Xml(t4noBox14);
console.log("Valid:", t4result.valid);
console.log("Errors:", JSON.stringify(t4result.errors, null, 2));
console.log("Warnings:", JSON.stringify(t4result.warnings, null, 2));

// Check specific assertions
console.log("Has 'Box14' in errors:", t4result.errors.some(e => e.includes("Box14")));
console.log("");

// --- T4A zero income test reproduction ---
function buildTestT4A() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<T4ASubmission
  xmlns="http://www.cra-arc.gc.ca/xml/t619/2026"
  taxYear="2026"
  submissionID="T4A-2026-1">
  <TaxYear>2026</TaxYear>
  <Payer>
    <PayerLegalName>Test Inc.</PayerLegalName>
    <PayerBN>123456789RP0001</PayerBN>
    <PayerOperatingName>Test</PayerOperatingName>
  </Payer>
  <Recipient>
    <RecipientName>Partner Test</RecipientName>
    <RecipientIdentifier>123456789</RecipientIdentifier>
    <AddressLine1>456 Partner Ave</AddressLine1>
    <City>Richmond</City>
    <Province>BC</Province>
    <PostalCode>V7E 2B3</PostalCode>
  </Recipient>
  <T4ABoxes>
    <Box016>0.00</Box016>
    <Box020>0.00</Box020>
    <Box022>0.00</Box022>
    <Box028>0.00</Box028>
    <Box048>0.00</Box048>
  </T4ABoxes>
</T4ASubmission>`;
}

const t4axml = buildTestT4A();
const t4aresult = validateT4AXml(t4axml);
console.log("=== T4A: All zero boxes ===");
console.log("Valid:", t4aresult.valid);
console.log("Errors:", JSON.stringify(t4aresult.errors, null, 2));
console.log("Warnings:", JSON.stringify(t4aresult.warnings, null, 2));

// Check specific assertions
console.log("Has 'boxes' in errors:", t4aresult.errors.some(e => e.toLowerCase().includes("boxes")));
console.log("Has '0' in errors:", t4aresult.errors.some(e => e.includes("0")));
