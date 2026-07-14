import { describe, it } from "node:test";
import assert from "node:assert";
import {
  BADGE_CATALOG,
  COMPUTABLE_BADGE_KEYS,
  isEligibleForServiceGold,
  countExcellentAudits,
  isEligibleForDetailMaster,
  isEligibleForPromotionReady,
} from "../../src/lib/badges";

describe("BADGE_CATALOG", () => {
  it("solo 3 insignias son computable=true, documentadas honestamente", () => {
    assert.deepEqual(
      COMPUTABLE_BADGE_KEYS.sort(),
      ["detail_master", "promotion_ready", "service_gold"].sort()
    );
  });

  it("toda insignia no computable tiene una razón explícita", () => {
    for (const badge of Object.values(BADGE_CATALOG)) {
      if (!badge.computable) {
        assert.ok(badge.blockedReason && badge.blockedReason.length > 0, `${badge.key} debe tener blockedReason`);
      }
    }
  });
});

describe("isEligibleForServiceGold", () => {
  it("false por debajo de 50", () => {
    assert.equal(isEligibleForServiceGold({ completedServicesWithoutDisputeCount: 49 }), false);
  });

  it("true en 50 exacto", () => {
    assert.equal(isEligibleForServiceGold({ completedServicesWithoutDisputeCount: 50 }), true);
  });

  it("true por encima de 50", () => {
    assert.equal(isEligibleForServiceGold({ completedServicesWithoutDisputeCount: 120 }), true);
  });
});

describe("countExcellentAudits / isEligibleForDetailMaster", () => {
  it("cuenta solo auditorías >= 92% del máximo de ESA auditoría", () => {
    const audits = [
      { criteriaSum: 23, criteriaMax: 25 }, // 92% exacto -> cuenta
      { criteriaSum: 18, criteriaMax: 20 }, // 90% -> no cuenta (escala de 4 criterios)
      { criteriaSum: 19, criteriaMax: 20 }, // 95% -> cuenta
      { criteriaSum: 0, criteriaMax: 0 },   // sin criterios -> nunca cuenta, no explota
    ];
    assert.equal(countExcellentAudits(audits), 2);
  });

  it("requiere 10 auditorías excelentes, no menos", () => {
    const nine = Array.from({ length: 9 }, () => ({ criteriaSum: 25, criteriaMax: 25 }));
    assert.equal(isEligibleForDetailMaster(nine), false);
    const ten = Array.from({ length: 10 }, () => ({ criteriaSum: 25, criteriaMax: 25 }));
    assert.equal(isEligibleForDetailMaster(ten), true);
  });
});

describe("isEligibleForPromotionReady", () => {
  it("false con menos de 4 semanas de historial", () => {
    assert.equal(isEligibleForPromotionReady([95, 92, 91]), false);
  });

  it("false si alguna de las últimas 4 semanas no supera 90", () => {
    assert.equal(isEligibleForPromotionReady([95, 92, 89, 91, 99]), false);
  });

  it("true si las últimas 4 semanas consecutivas superan 90", () => {
    assert.equal(isEligibleForPromotionReady([95, 92, 91, 99, 50]), true);
  });

  it("un score pasado bajo, fuera de las últimas 4, no importa", () => {
    assert.equal(isEligibleForPromotionReady([91, 92, 93, 94, 10, 10, 10]), true);
  });
});
