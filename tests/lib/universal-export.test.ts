import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildUniversalExportJson,
  buildUniversalExportCsv,
  parseUniversalExportCsv,
  UNIVERSAL_EXPORT_SCHEMA_VERSION,
  type UniversalExportRecord,
} from "../../src/lib/universal-export";

const sampleRecords: UniversalExportRecord[] = [
  { category: "revenue", description: "Servicios Julio, cobrado", amountCents: 1_250_000, date: "2026-07-15" },
  { category: "payroll_gross", description: "Nómina Q1 Julio, bruto", amountCents: 480_000, date: "2026-07-15" },
  {
    category: "partner_commission",
    description: 'Comisión "Agente, Referido" 123',
    amountCents: 12_500,
    date: "2026-07-20",
    metadata: { partnerType: "real_estate_agent", requiresT4A: "true" },
  },
  { category: "retention_gift", description: "Regalo tier1", amountCents: 9_000, date: "2026-07-22" },
];

describe("buildUniversalExportJson", () => {
  it("incluye version de esquema, mes, y totales por categoria", () => {
    const doc = buildUniversalExportJson(sampleRecords, "2026-07", "2026-08-01T00:00:00Z");
    assert.equal(doc.schemaVersion, UNIVERSAL_EXPORT_SCHEMA_VERSION);
    assert.equal(doc.month, "2026-07");
    assert.equal(doc.records.length, 4);
    assert.equal(doc.totalsByCategory.revenue, 1_250_000);
    assert.equal(doc.totalsByCategory.partner_commission, 12_500);
  });
});

describe("buildUniversalExportCsv + parseUniversalExportCsv (round-trip)", () => {
  it("produce un CSV con encabezado documentado", () => {
    const csv = buildUniversalExportCsv(sampleRecords, "2026-07");
    const header = csv.split("\n")[0];
    assert.equal(header, "schema_version,month,category,description,amount_cad,currency,metadata_json");
  });

  it("re-importa el CSV sin perdida de datos, incluyendo descripciones con comas y comillas", () => {
    const csv = buildUniversalExportCsv(sampleRecords, "2026-07");
    const parsed = parseUniversalExportCsv(csv);

    assert.equal(parsed.length, sampleRecords.length);

    parsed.forEach((row, i) => {
      const original = sampleRecords[i];
      assert.equal(row.schemaVersion, UNIVERSAL_EXPORT_SCHEMA_VERSION);
      assert.equal(row.month, "2026-07");
      assert.equal(row.category, original.category);
      assert.equal(row.description, original.description);
      assert.equal(row.amountCents, original.amountCents);
      assert.equal(row.currency, "CAD");
      if (original.metadata) {
        assert.deepEqual(row.metadata, original.metadata);
      } else {
        assert.equal(row.metadata, null);
      }
    });
  });

  it("mantiene los totales iguales entre JSON y CSV re-importado", () => {
    const doc = buildUniversalExportJson(sampleRecords, "2026-07", "2026-08-01T00:00:00Z");
    const csv = buildUniversalExportCsv(sampleRecords, "2026-07");
    const parsed = parseUniversalExportCsv(csv);
    const csvTotal = parsed.reduce((sum, r) => sum + r.amountCents, 0);
    const jsonTotal = Object.values(doc.totalsByCategory).reduce((sum, v) => sum + v, 0);
    assert.equal(csvTotal, jsonTotal);
  });
});
