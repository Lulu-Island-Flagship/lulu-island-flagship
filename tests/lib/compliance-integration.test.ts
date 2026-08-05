/**
 * v8.3 — Compliance Integration Tests.
 *
 * Pruebas de integración del módulo compliance: motor de reglas versionadas,
 * sincronización con feed legal, flujo approve/reject, y edge cases de cambio
 * de año y tasas mid-period.
 *
 * Usa ComplianceStore en memoria — sin dependencia de Supabase.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  approveChange,
  rejectChange,
  type ComplianceStore,
  type PendingChange,
} from "../../src/lib/compliance-sync";
import {
  detectChanges,
  proposeNewVersion,
  type LegalFeedEntry,
  type DetectedChange,
} from "../../src/lib/compliance-feed";
import {
  CPP_2026_SEED,
  EI_2026_SEED,
  GST_2026_SEED,
  type ReglaLegalRow,
  type TipoRegla,
} from "../../src/lib/compliance-engine";
import { getCurrentRate } from "../../src/lib/compliance-resolver";

// =========================================================================
// In-Memory ComplianceStore
// =========================================================================

/**
 * Implementación en memoria del ComplianceStore para testing.
 * Satisface la interfaz completa sin dependencia de base de datos.
 */
class InMemoryComplianceStore implements ComplianceStore {
  private rules: Map<string, ReglaLegalRow> = new Map();
  /** Log inmutable de auditoría. */
  readonly auditLog: Array<{
    tabla: string;
    registro_id: string;
    accion: string;
    admin_id: string;
    motivo: string | null;
    metadata: Record<string, unknown> | null;
  }> = [];

  /** Pre-carga los seeds 2026 como reglas VIGENTES. */
  seed2026(): void {
    const seeds = [
      { ...CPP_2026_SEED, id: "cpp-2026", creado_en: "2026-01-01T00:00:00.000Z", creado_por: "seed", vigente_hasta: null },
      { ...EI_2026_SEED, id: "ei-2026", creado_en: "2026-01-01T00:00:00.000Z", creado_por: "seed", vigente_hasta: null },
      {
        ...GST_2026_SEED,
        id: "gst-2026",
        creado_en: "2026-01-01T00:00:00.000Z",
        creado_por: "seed",
        vigente_hasta: null,
      },
    ] as ReglaLegalRow[];

    for (const seed of seeds) {
      this.rules.set(seed.id, seed);
    }
  }

  /** Inserta una regla arbitraria (útil para crear PENDIENTES). */
  insertRuleDirect(rule: ReglaLegalRow): void {
    this.rules.set(rule.id, rule);
  }

  getActiveRules(): ReglaLegalRow[] {
    return [...this.rules.values()].filter((r) => r.estado === "VIGENTE");
  }

  getPendingRules(): ReglaLegalRow[] {
    return [...this.rules.values()].filter((r) => r.estado === "PENDIENTE");
  }

  getRuleById(id: string): ReglaLegalRow | null {
    return this.rules.get(id) ?? null;
  }

  getActiveRuleByType(tipo: TipoRegla): ReglaLegalRow | null {
    return [...this.rules.values()].find(
      (r) => r.tipo === tipo && r.estado === "VIGENTE"
    ) ?? null;
  }

  insertRule(rule: Omit<ReglaLegalRow, "id" | "creado_en"> & { id?: string; creado_en?: string }): ReglaLegalRow {
    const id = rule.id ?? `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const creado_en = rule.creado_en ?? new Date().toISOString();
    const full: ReglaLegalRow = { ...rule, id, creado_en } as ReglaLegalRow;
    this.rules.set(id, full);
    return full;
  }

  updateRule(id: string, updates: Partial<Pick<ReglaLegalRow, "estado" | "vigente_desde" | "vigente_hasta" | "notas">>): ReglaLegalRow {
    const existing = this.rules.get(id);
    if (!existing) throw new Error(`Rule ${id} not found`);
    const updated = { ...existing, ...updates };
    this.rules.set(id, updated);
    return updated;
  }

  insertAuditLog(entry: { tabla: string; registro_id: string; accion: string; admin_id: string; motivo: string | null; metadata: Record<string, unknown> | null }): void {
    this.auditLog.push(entry);
  }
}

function makeStore(): InMemoryComplianceStore {
  const store = new InMemoryComplianceStore();
  store.seed2026();
  return store;
}

// =========================================================================
// getActiveRules — reglas vigentes por fecha
// =========================================================================

describe("ComplianceStore.getActiveRules", () => {
  it("retorna reglas VIGENTES correctas para 2026", () => {
    const store = makeStore();
    const activeRules = store.getActiveRules();

    // Los seeds cargan CPP, EI, GST
    assert.ok(activeRules.length >= 3, "Debe haber al menos 3 reglas vigentes");

    const cppRule = activeRules.find((r) => r.tipo === "CPP");
    assert.ok(cppRule, "CPP debe estar vigente");
    assert.strictEqual(cppRule!.estado, "VIGENTE");
    assert.strictEqual(cppRule!.version, "2026-01");
  });

  it("no retorna reglas PENDIENTES o HISTORICAS", () => {
    const store = makeStore();
    const activeRules = store.getActiveRules();
    const hasNonVigente = activeRules.some((r) => r.estado !== "VIGENTE");
    assert.strictEqual(hasNonVigente, false, "Todas las reglas activas deben ser VIGENTE");
  });

  it("getActiveRuleByType retorna la regla VIGENTE para un tipo específico", () => {
    const store = makeStore();
    const cpp = store.getActiveRuleByType("CPP");
    assert.ok(cpp, "CPP debe tener regla vigente");
    assert.strictEqual(cpp!.tipo, "CPP");
    assert.strictEqual(cpp!.estado, "VIGENTE");
  });
});

// =========================================================================
// Cambio de año — 1 de enero con nuevas tasas
// =========================================================================

describe("Cambio de año: nuevas tasas CPP/EI", () => {
  it("getCurrentRate retorna tasas 2026 para fecha en 2026", () => {
    const cppRate = getCurrentRate("CPP", new Date("2026-06-15"));
    assert.ok(cppRate, "CPP rate debe existir para 2026");
    assert.strictEqual((cppRate as { tasa_empleado: number }).tasa_empleado, 0.0595);

    const eiRate = getCurrentRate("EI", new Date("2026-06-15"));
    assert.ok(eiRate, "EI rate debe existir para 2026");
    assert.strictEqual((eiRate as { tasa_empleado: number }).tasa_empleado, 0.0163);
  });

  it("el 1 de enero usa las tasas del nuevo año", () => {
    // Justo en el borde del año — debe seguir vigente el seed 2026
    const cppJan1 = getCurrentRate("CPP", new Date("2026-01-01"));
    assert.ok(cppJan1, "CPP debe estar vigente el 1 de enero 2026");
    assert.strictEqual((cppJan1 as { tasa_empleado: number }).tasa_empleado, 0.0595);
  });

  it("el 31 de diciembre 2026 aún usa tasas 2026", () => {
    const cppDec31 = getCurrentRate("CPP", new Date("2026-12-31T23:59:59.000Z"));
    assert.ok(cppDec31, "CPP debe estar vigente el 31 de diciembre 2026");
  });

  it("fecha anterior a la vigencia retorna null (sin regla)", () => {
    // El seed CPP_2026 tiene vigente_desde = 2026-01-01
    const cppOld = getCurrentRate("CPP", new Date("2025-12-31"));
    assert.strictEqual(cppOld, null, "No debe haber CPP vigente antes de 2026-01-01");
  });
});

// =========================================================================
// approveChange — activa nueva versión, expira la anterior
// =========================================================================

describe("approveChange", () => {
  it("activa una versión PENDIENTE y expira la versión VIGENTE anterior", () => {
    const store = makeStore();

    // Hay una regla CPP VIGENTE (cpp-2026)
    const cppVigente = store.getActiveRuleByType("CPP");
    assert.ok(cppVigente, "CPP debe estar vigente antes de aprobar");
    assert.strictEqual(cppVigente!.estado, "VIGENTE");

    // Creamos una nueva versión PENDIENTE de CPP
    const newCpp: ReglaLegalRow = {
      id: "cpp-2027-pending",
      jurisdiccion: "Federal",
      tipo: "CPP",
      version: "2027-01",
      parametros: { tasa_empleado: 0.0625, tope: 72000, exencion_basica: 3500 },
      estado: "PENDIENTE",
      vigente_desde: null,
      vigente_hasta: null,
      creado_por: "admin-test",
      creado_en: new Date().toISOString(),
      notas: "CPP rates for 2027",
    };
    store.insertRuleDirect(newCpp);

    // Aprobar
    const result = approveChange(store, "cpp-2027-pending", "admin-01");
    assert.strictEqual(result.success, true, result.message);

    // Verificar: nueva versión VIGENTE
    const newActive = store.getRuleById("cpp-2027-pending");
    assert.ok(newActive, "Nueva versión debe existir");
    assert.strictEqual(newActive!.estado, "VIGENTE");
    assert.ok(newActive!.vigente_desde, "Debe tener vigente_desde");

    // Verificar: versión anterior HISTORICO con vigente_hasta
    const oldActive = store.getRuleById("cpp-2026");
    assert.ok(oldActive, "Versión anterior debe existir");
    assert.strictEqual(oldActive!.estado, "HISTORICO");
    assert.ok(oldActive!.vigente_hasta, "Versión anterior debe tener vigente_hasta");
  });

  it("rechaza aprobar una regla que no está PENDIENTE", () => {
    const store = makeStore();

    // Intentar aprobar una regla VIGENTE
    const result = approveChange(store, "cpp-2026", "admin-01");
    assert.strictEqual(result.success, false);
    assert.match(result.message, /PENDIENTE/);
  });

  it("retorna error si la regla no existe", () => {
    const store = makeStore();
    const result = approveChange(store, "nonexistent-id", "admin-01");
    assert.strictEqual(result.success, false);
    assert.match(result.message, /No se encontró/);
  });
});

// =========================================================================
// rejectChange — no afecta la versión vigente
// =========================================================================

describe("rejectChange", () => {
  it("rechaza una versión PENDIENTE sin modificar la VIGENTE", () => {
    const store = makeStore();

    // Estado inicial: CPP VIGENTE
    const cppVigente = store.getActiveRuleByType("CPP");
    assert.strictEqual(cppVigente!.estado, "VIGENTE");

    // Creamos PENDIENTE
    const pendingCpp: ReglaLegalRow = {
      id: "cpp-rejected",
      jurisdiccion: "Federal",
      tipo: "CPP",
      version: "2027-01",
      parametros: { tasa_empleado: 0.07, tope: 75000, exencion_basica: 4000 },
      estado: "PENDIENTE",
      vigente_desde: null,
      vigente_hasta: null,
      creado_por: "feed",
      creado_en: new Date().toISOString(),
      notas: "Propuesta rechazada — tasa demasiado alta",
    };
    store.insertRuleDirect(pendingCpp);

    // Rechazar
    const result = rejectChange(store, "cpp-rejected", "admin-02", "Tasa no confirmada por CRA");
    assert.strictEqual(result.success, true, result.message);

    // Verificar: PENDIENTE → HISTORICO
    const rejected = store.getRuleById("cpp-rejected");
    assert.strictEqual(rejected!.estado, "HISTORICO");

    // Verificar: VIGENTE no se tocó
    const stillActive = store.getActiveRuleByType("CPP");
    assert.ok(stillActive, "CPP vigente debe seguir existiendo");
    assert.strictEqual(stillActive!.id, "cpp-2026", "La versión VIGENTE original no debe cambiar");
    assert.strictEqual(stillActive!.estado, "VIGENTE");
  });

  it("rechaza sin motivo lanza error", () => {
    const store = makeStore();
    const pendingCpp: ReglaLegalRow = {
      id: "cpp-no-motivo",
      jurisdiccion: "Federal",
      tipo: "CPP",
      version: "2027-01",
      parametros: { tasa_empleado: 0.06, tope: 70000, exencion_basica: 3500 },
      estado: "PENDIENTE",
      vigente_desde: null,
      vigente_hasta: null,
      creado_por: "feed",
      creado_en: new Date().toISOString(),
      notas: "",
    };
    store.insertRuleDirect(pendingCpp);

    const result = rejectChange(store, "cpp-no-motivo", "admin-03", "   ");
    assert.strictEqual(result.success, false);
    assert.match(result.message, /motivo/);
  });
});

// =========================================================================
// Sincronización con feed legal
// =========================================================================

describe("Compliance Feed — detectChanges + proposeNewVersion", () => {
  it("detectChanges: detecta parámetros cambiados vs versión VIGENTE", () => {
    const feedEntry: LegalFeedEntry = {
      source: "CRA",
      tipo: "CPP",
      jurisdiccion: "Federal",
      parametros: {
        tasa_empleado: 0.0625,   // Cambió de 0.0595 a 0.0625
        tope: 72000,              // Cambió de 68500 a 72000
        exencion_basica: 3500,    // Igual
      },
      publishedAt: "2026-11-15T00:00:00.000Z",
      referenceUrl: "https://canada.ca/cra/cpp-2027",
    };

    const currentParams = CPP_2026_SEED.parametros;
    const change: DetectedChange = detectChanges(feedEntry, currentParams);

    assert.ok(change.changedKeys.includes("tasa_empleado"), "tasa_empleado debe estar en changedKeys");
    assert.ok(change.changedKeys.includes("tope"), "tope debe estar en changedKeys");
    // exencion_basica NO cambió
    assert.strictEqual(change.changedKeys.includes("exencion_basica"), false);
  });

  it("detectChanges: sin versión previa, todos los keys son nuevos", () => {
    const feedEntry: LegalFeedEntry = {
      source: "BC_GOV",
      tipo: "WorkSafeBC",
      jurisdiccion: "BC",
      parametros: { class_rate: 2.35, class_code: "12345" },
      publishedAt: "2026-08-01T00:00:00.000Z",
    };

    const change = detectChanges(feedEntry, null);
    assert.strictEqual(change.changedKeys.length, 2);
    assert.ok(change.changedKeys.includes("class_rate"));
    assert.ok(change.changedKeys.includes("class_code"));
  });

  it("proposeNewVersion: crea una propuesta PENDIENTE desde un cambio detectado", () => {
    const feedEntry: LegalFeedEntry = {
      source: "CRA",
      tipo: "EI",
      jurisdiccion: "Federal",
      parametros: { tasa_empleado: 0.0170, tope: 68000, tasa_employer: 1.4 },
      publishedAt: "2026-10-01T00:00:00.000Z",
      effectiveDate: "2027-01-01",
    };

    const change = detectChanges(feedEntry, EI_2026_SEED.parametros);
    const proposal = proposeNewVersion(change, "compliance-feed");

    assert.strictEqual(proposal.estado, "PENDIENTE");
    assert.strictEqual(proposal.tipo, "EI");
    assert.strictEqual(proposal.newVersion, "2027-01"); // effectiveDate dicta la versión
    assert.strictEqual(proposal.jurisdiccion, "Federal");
  });

  it("syncFromLegalFeed: detecta cambio y crea PENDIENTE para GST", () => {
    // Simulamos un feed entry de GST con tasa cambiada
    const gstFeedEntry: LegalFeedEntry = {
      source: "CRA",
      tipo: "GST",
      jurisdiccion: "Federal",
      parametros: { tasa: 0.06 },  // subió de 5% a 6%
      publishedAt: "2026-09-01T00:00:00.000Z",
      effectiveDate: "2027-01-01",
    };

    const currentGstParams = GST_2026_SEED.parametros;
    const change = detectChanges(gstFeedEntry, currentGstParams);

    assert.ok(change.changedKeys.includes("tasa"), "GST tasa debe detectarse como cambio");
    assert.strictEqual(change.changedKeys.length, 1);

    const proposal = proposeNewVersion(change);
    assert.strictEqual(proposal.estado, "PENDIENTE");
    assert.strictEqual(proposal.tipo, "GST");
  });
});

// =========================================================================
// Edge cases — compliance
// =========================================================================

describe("Compliance edge cases", () => {
  it("dos cambios de ley en el mismo mes generan versiones PENDIENTES separadas", () => {
    const store = makeStore();

    // Cambio CPP
    const cppPending: ReglaLegalRow = {
      id: "cpp-2027-pend",
      jurisdiccion: "Federal",
      tipo: "CPP",
      version: "2027-01",
      parametros: { tasa_empleado: 0.0625, tope: 72000, exencion_basica: 3500 },
      estado: "PENDIENTE",
      vigente_desde: null,
      vigente_hasta: null,
      creado_por: "feed",
      creado_en: "2026-11-15T00:00:00.000Z",
      notas: "CPP 2027 rates",
    };

    // Cambio EI en el mismo mes
    const eiPending: ReglaLegalRow = {
      id: "ei-2027-pend",
      jurisdiccion: "Federal",
      tipo: "EI",
      version: "2027-01",
      parametros: { tasa_empleado: 0.0170, tope: 68000, tasa_employer: 1.4 },
      estado: "PENDIENTE",
      vigente_desde: null,
      vigente_hasta: null,
      creado_por: "feed",
      creado_en: "2026-11-20T00:00:00.000Z",
      notas: "EI 2027 rates",
    };

    store.insertRuleDirect(cppPending);
    store.insertRuleDirect(eiPending);

    const pending = store.getPendingRules();
    assert.ok(pending.length >= 2, "Debe haber al menos 2 reglas PENDIENTES");

    // Aprobar ambas
    const resultCpp = approveChange(store, "cpp-2027-pend", "admin-01");
    assert.strictEqual(resultCpp.success, true);

    const resultEi = approveChange(store, "ei-2027-pend", "admin-01");
    assert.strictEqual(resultEi.success, true);

    // Ambas deben ser VIGENTE ahora
    const cppAfter = store.getRuleById("cpp-2027-pend");
    const eiAfter = store.getRuleById("ei-2027-pend");
    assert.strictEqual(cppAfter!.estado, "VIGENTE");
    assert.strictEqual(eiAfter!.estado, "VIGENTE");

    // Las versiones 2026 deben ser HISTORICO
    const cppOld = store.getRuleById("cpp-2026");
    const eiOld = store.getRuleById("ei-2026");
    assert.strictEqual(cppOld!.estado, "HISTORICO");
    assert.strictEqual(eiOld!.estado, "HISTORICO");
  });

  it("GST rate change mid-period: la nueva tasa no afecta períodos ya cerrados", () => {
    // Simulamos: GST cambia de 5% a 6% a partir de 2026-08-15
    // Un período 2026-08 que cierra el 15 debe usar la tasa vieja
    const gstBefore = getCurrentRate("GST", new Date("2026-08-14"));
    assert.ok(gstBefore);
    assert.strictEqual((gstBefore as { tasa: number }).tasa, 0.05);

    // Si se inserta una nueva regla VIGENTE desde 2026-08-15
    const store = makeStore();
    const newGst: ReglaLegalRow = {
      id: "gst-2026-mid",
      jurisdiccion: "Federal",
      tipo: "GST",
      version: "2026-08",
      parametros: { tasa: 0.06 },
      estado: "VIGENTE",
      vigente_desde: "2026-08-15T00:00:00.000Z",
      vigente_hasta: null,
      creado_por: "admin",
      creado_en: "2026-08-15T00:00:00.000Z",
      notas: "Mid-year GST rate change",
    };

    // Marcar versión anterior como HISTORICO con vigente_hasta
    store.updateRule("gst-2026", {
      estado: "HISTORICO",
      vigente_hasta: "2026-08-15T00:00:00.000Z",
    });
    store.insertRuleDirect(newGst);

    // La tasa VIGENTE ahora es 0.06
    const activeGst = store.getActiveRuleByType("GST");
    assert.ok(activeGst);
    assert.strictEqual((activeGst!.parametros as { tasa: number }).tasa, 0.06);

    // Pero los asientos del 1 al 14 de agosto usan la tasa HISTORICA (0.05)
    const oldGst = store.getRuleById("gst-2026");
    assert.strictEqual(oldGst!.estado, "HISTORICO");
    assert.strictEqual((oldGst!.parametros as { tasa: number }).tasa, 0.05);
  });

  it("no se puede aprobar una regla que ya es VIGENTE", () => {
    const store = makeStore();
    const result = approveChange(store, "cpp-2026", "admin-01");
    assert.strictEqual(result.success, false);
  });
});
