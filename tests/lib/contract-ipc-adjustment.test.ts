import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getContractAnniversary,
  isIpcNoticeDue,
  isIpcAdjustmentDue,
  calculateIpcAdjustedContractPrice,
  CONTRACT_IPC_NOTICE_DAYS,
} from "../../src/lib/contract-ipc-adjustment";

describe("getContractAnniversary", () => {
  it("mismo mes/dia, año pedido", () => {
    const d = getContractAnniversary("2025-03-15", 2026);
    assert.equal(d.toISOString().slice(0, 10), "2026-03-15");
  });

  it("29 de febrero en año no bisiesto cae al 28", () => {
    const d = getContractAnniversary("2024-02-29", 2026); // 2026 no es bisiesto
    assert.equal(d.toISOString().slice(0, 10), "2026-02-28");
  });

  it("29 de febrero en año bisiesto se mantiene", () => {
    const d = getContractAnniversary("2024-02-29", 2028); // 2028 es bisiesto
    assert.equal(d.toISOString().slice(0, 10), "2028-02-29");
  });
});

describe("isIpcNoticeDue", () => {
  it("es true exactamente 30 dias antes del aniversario", () => {
    // Aniversario 2026-07-15 -> aviso el 2026-06-15
    assert.equal(isIpcNoticeDue("2024-07-15", "2026-06-15", 2026), true);
  });

  it("es false 29 o 31 dias antes", () => {
    assert.equal(isIpcNoticeDue("2024-07-15", "2026-06-16", 2026), false);
    assert.equal(isIpcNoticeDue("2024-07-15", "2026-06-14", 2026), false);
  });

  it("CONTRACT_IPC_NOTICE_DAYS es 30 (D.9 Doc 2)", () => {
    assert.equal(CONTRACT_IPC_NOTICE_DAYS, 30);
  });
});

describe("isIpcAdjustmentDue", () => {
  it("es true el dia exacto del aniversario, año posterior al inicio", () => {
    assert.equal(isIpcAdjustmentDue("2024-07-15", "2026-07-15", 2026), true);
  });

  it("es false en cualquier otro dia", () => {
    assert.equal(isIpcAdjustmentDue("2024-07-15", "2026-07-16", 2026), false);
  });

  it("nunca aplica en el primer año del contrato (year <= startYear)", () => {
    assert.equal(isIpcAdjustmentDue("2026-07-15", "2026-07-15", 2026), false);
  });
});

describe("calculateIpcAdjustedContractPrice", () => {
  it("aplica el % IPC positivo correctamente", () => {
    const r = calculateIpcAdjustedContractPrice({
      currentBasePrice: 200,
      currentTotal: 250,
      ipcPercentage: 3,
    });
    assert.equal(r.newBasePrice, 206);
    assert.equal(r.newTotal, 257.5);
    assert.equal(r.deltaBasePriceDollars, 6);
  });

  it("sin cambio (0%), precio identico", () => {
    const r = calculateIpcAdjustedContractPrice({
      currentBasePrice: 200,
      currentTotal: 250,
      ipcPercentage: 0,
    });
    assert.equal(r.newBasePrice, 200);
    assert.equal(r.deltaBasePriceDollars, 0);
  });

  it("IPC negativo (deflacion) reduce el precio", () => {
    const r = calculateIpcAdjustedContractPrice({
      currentBasePrice: 200,
      currentTotal: 250,
      ipcPercentage: -2,
    });
    assert.equal(r.newBasePrice, 196);
    assert.ok(r.deltaBasePriceDollars < 0);
  });
});
