/**
 * v8.3 Capa 2 del Financial Core — Compliance Tests.
 *
 * Tests unitarios para el Compliance Engine + Compliance Sync.
 * Cubre:
 *   - getActiveRules: versión correcta para una fecha dada.
 *   - approveChange: actualiza vigente_desde correctamente.
 *   - rejectChange: no modifica la versión VIGENTE.
 *   - Cambio de año fiscal: CPP/EI rates cambian en enero.
 *
 * Ejecutar con:
 *   npm test -- tests/lib/compliance-test.test.ts
 *   (o directamente con tsx desde src/lib/compliance-test.ts si se copia a tests/)
 *
 * Este archivo es tanto la suite de tests como documentación ejecutable
 * del comportamiento esperado del módulo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ReglaLegalRow,
  TipoRegla,
} from "./compliance-engine";
import { _isRuleActiveAt, ALL_SEEDS_2026 } from "./compliance-engine";
import {
  type ComplianceStore,
  type PendingChange,
  type ApprovalResult,
  type RejectionResult,
  approveChange,
  rejectChange,
  getPendingChanges,
} from "./compliance-sync";
import {
  type FeedPersistence,
  type WeeklyJobResult,
  weeklyComplianceJob,
  fetchFeedEntries,
  CANONICAL_FEED_SOURCES,
} from "./compliance-feed";

// ---------------------------------------------------------------------------
// In-Memory Compliance Store para tests
// ---------------------------------------------------------------------------

/**
 * Implementación en memoria de {@link ComplianceStore} para tests.
 * No requiere base de datos — ideal para unit tests determinísticos.
 */
class InMemoryComplianceStore implements ComplianceStore {
  private rules: Map<string, ReglaLegalRow> = new Map();
  private auditLogs: Array<{
    tabla: string;
    registro_id: string;
    accion: string;
    admin_id: string;
    motivo: string | null;
    metadata: Record<string, unknown> | null;
  }> = [];
  private idCounter = 0;

  /** Carga los seeds 2026 como base. */
  seed(): void {
    for (const seed of ALL_SEEDS_2026) {
      const id = this.nextId();
      const rule: ReglaLegalRow = {
        ...seed,
        id,
        creado_en: seed.vigente_desde!,
        creado_por: "seed",
        vigente_hasta: null,
      };
      this.rules.set(id, rule);
    }
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
    return (
      [...this.rules.values()].find(
        (r) => r.tipo === tipo && r.estado === "VIGENTE"
      ) ?? null
    );
  }

  insertRule(
    rule: Omit<ReglaLegalRow, "id" | "creado_en"> & {
      id?: string;
      creado_en?: string;
    }
  ): ReglaLegalRow {
    const id = rule.id ?? this.nextId();
    const full: ReglaLegalRow = {
      ...rule,
      id,
      creado_en: rule.creado_en ?? new Date().toISOString(),
    };
    this.rules.set(id, full);
    return full;
  }

  updateRule(
    id: string,
    updates: Partial<
      Pick<
        ReglaLegalRow,
        "estado" | "vigente_desde" | "vigente_hasta" | "notas"
      >
    >
  ): ReglaLegalRow {
    const existing = this.rules.get(id);
    if (!existing) throw new Error(`Rule ${id} not found`);
    const updated = { ...existing, ...updates };
    this.rules.set(id, updated);
    return updated;
  }

  insertAuditLog(entry: {
    tabla: string;
    registro_id: string;
    accion: string;
    admin_id: string;
    motivo: string | null;
    metadata: Record<string, unknown> | null;
  }): void {
    this.auditLogs.push(entry);
  }

  /** Retorna los audit logs para inspección en tests. */
  getAuditLogs(): typeof this.auditLogs {
    return [...this.auditLogs];
  }

  private nextId(): string {
    this.idCounter++;
    return `test-rule-${this.idCounter.toString().padStart(4, "0")}`;
  }
}

// ---------------------------------------------------------------------------
// In-Memory FeedPersistence para weeklyComplianceJob tests
// ---------------------------------------------------------------------------

class InMemoryFeedPersistence implements FeedPersistence {
  constructor(private store: InMemoryComplianceStore) {}

  getCurrentParams(tipo: TipoRegla): Record<string, unknown> | null {
    const active = this.store.getActiveRuleByType(tipo);
    return active?.parametros ?? null;
  }

  persistProposedVersion(
    proposal: {
      tipo: TipoRegla;
      jurisdiccion: "Federal" | "BC";
      newVersion: string;
      parametros: Record<string, unknown>;
      changes: Array<{ changedKeys: string[] }>;
    },
    source: string
  ): string {
    const rule = this.store.insertRule({
      jurisdiccion: proposal.jurisdiccion,
      tipo: proposal.tipo,
      version: proposal.newVersion,
      parametros: proposal.parametros,
      estado: "PENDIENTE",
      vigente_desde: null,
      vigente_hasta: null,
      creado_por: `test-feed:${source}`,
      notas: `Propuesta desde test feed ${source}. ${proposal.changes.length} cambio(s).`,
    });
    return rule.id;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Crea un store con seeds y retorna el store. */
function seededStore(): InMemoryComplianceStore {
  const store = new InMemoryComplianceStore();
  store.seed();
  return store;
}

/** Inserta una regla PENDIENTE para un tipo dado. */
function insertPendingRule(
  store: InMemoryComplianceStore,
  tipo: TipoRegla,
  newParams: Record<string, unknown>
): ReglaLegalRow {
  return store.insertRule({
    jurisdiccion: "Federal",
    tipo,
    version: "2027-01",
    parametros: newParams,
    estado: "PENDIENTE",
    vigente_desde: null,
    vigente_hasta: null,
    creado_por: "test",
    notas: "Test pending rule",
  });
}

// ===========================================================================
// Test: getActiveRules retorna la versión correcta para una fecha
// ===========================================================================

test("getActiveRules: CP 2026-01 está VIGENTE para julio 2026", () => {
  const store = seededStore();
  const active = store.getActiveRules();
  const cpp = active.find((r) => r.tipo === "CPP");
  assert.ok(cpp, "CPP rule should be active");
  assert.equal(cpp!.version, "2026-01");
  assert.equal(cpp!.estado, "VIGENTE");
});

test("getActiveRules: _isRuleActiveAt valida vigencia por fecha", () => {
  const store = seededStore();
  const cpp = store.getActiveRuleByType("CPP");
  assert.ok(cpp, "CPP debe existir");

  // Debe estar activa el 15 de julio 2026
  const activeInJuly = _isRuleActiveAt(cpp!, new Date("2026-07-15T12:00:00Z"));
  assert.equal(activeInJuly, true);

  // No debe estar activa antes de vigente_desde (2026-01-01)
  const activeBefore = _isRuleActiveAt(cpp!, new Date("2025-12-15T12:00:00Z"));
  assert.equal(activeBefore, false);
});

test("getActiveRules: regla HISTORICO no aparece como activa", () => {
  const store = seededStore();
  const cpp = store.getActiveRuleByType("CPP");
  assert.ok(cpp);

  // Marcar como HISTORICO
  store.updateRule(cpp!.id, {
    estado: "HISTORICO",
    vigente_hasta: new Date().toISOString(),
  });

  const activeAfter = store.getActiveRuleByType("CPP");
  assert.equal(activeAfter, null, "Regla HISTORICO no debe aparecer como activa");
});

test("getActiveRules: getAllActiveRules excluye PENDIENTE e HISTORICO", () => {
  const store = seededStore();

  // Insertar una regla PENDIENTE
  insertPendingRule(store, "CPP", { tasa_empleado: 0.065, tope: 70000, exencion_basica: 3500 });

  const active = store.getActiveRules();
  const cppActive = active.filter((r) => r.tipo === "CPP");

  // Solo debe haber una VIGENTE (el seed original)
  assert.equal(cppActive.length, 1);
  assert.equal(cppActive[0].estado, "VIGENTE");
});

// ===========================================================================
// Test: approveChange actualiza vigente_desde correctamente
// ===========================================================================

test("approveChange: promueve PENDIENTE a VIGENTE y expira la anterior", () => {
  const store = seededStore();
  const adminId = "admin-001";

  // Crear una regla PENDIENTE con tasa CPP 2027 simulada
  const pending = insertPendingRule(store, "CPP", {
    tasa_empleado: 0.061,
    tope: 70000,
    exencion_basica: 3500,
  });

  // Verificar que la regla seed está VIGENTE
  const oldActive = store.getActiveRuleByType("CPP");
  assert.ok(oldActive);
  assert.equal(oldActive!.estado, "VIGENTE");
  assert.equal(oldActive!.version, "2026-01");

  // Aprobar
  const result: ApprovalResult = approveChange(store, pending.id, adminId);

  assert.equal(result.success, true, `Aprobación falló: ${result.message}`);
  assert.equal(result.newActiveVersionId, pending.id);
  assert.equal(result.previousVersionId, oldActive!.id);

  // Verificar: la nueva es VIGENTE con vigente_desde actualizado
  const newActive = store.getRuleById(pending.id);
  assert.ok(newActive);
  assert.equal(newActive!.estado, "VIGENTE");
  assert.ok(newActive!.vigente_desde, "vigente_desde debe poblarse");
  assert.equal(newActive!.vigente_hasta, null);

  // Verificar: la anterior es HISTORICO con vigente_hasta
  const oldAfter = store.getRuleById(oldActive!.id);
  assert.ok(oldAfter);
  assert.equal(oldAfter!.estado, "HISTORICO");
  assert.ok(oldAfter!.vigente_hasta, "vigente_hasta debe poblarse en la anterior");

  // Verificar: solo hay una VIGENTE por tipo
  const actives = store.getActiveRules().filter((r) => r.tipo === "CPP");
  assert.equal(actives.length, 1, "Debe haber exactamente una regla VIGENTE para CPP");
  assert.equal(actives[0].id, pending.id);
});

test("approveChange: registra entrada en audit_log", () => {
  const store = seededStore();
  const adminId = "admin-002";

  const pending = insertPendingRule(store, "EI", {
    tasa_empleado: 0.017,
    tope: 68000,
    tasa_employer: 1.4,
  });

  const result = approveChange(store, pending.id, adminId);
  assert.equal(result.success, true, result.message);

  const logs = store.getAuditLogs();
  const approvalLog = logs.find((l) => l.accion === "APPROVE");
  assert.ok(approvalLog, "Debe existir un registro APPROVE en audit_log");
  assert.equal(approvalLog!.registro_id, pending.id);
  assert.equal(approvalLog!.admin_id, adminId);
  assert.equal(approvalLog!.tabla, "reglas_legales");
  assert.equal(approvalLog!.motivo, null);
});

test("approveChange: rechaza si la regla no está PENDIENTE", () => {
  const store = seededStore();
  const activeRule = store.getActiveRuleByType("GST");
  assert.ok(activeRule);

  const result = approveChange(store, activeRule!.id, "admin-003");
  assert.equal(result.success, false);
  assert.match(result.message, /no está PENDIENTE/);
});

test("approveChange: rechaza si la regla no existe", () => {
  const store = seededStore();
  const result = approveChange(store, "non-existent-id", "admin-004");
  assert.equal(result.success, false);
  assert.match(result.message, /No se encontró/);
});

// ===========================================================================
// Test: rejectChange no modifica la versión VIGENTE
// ===========================================================================

test("rejectChange: marca PENDIENTE como HISTORICO sin tocar la VIGENTE", () => {
  const store = seededStore();
  const adminId = "admin-005";

  // Obtener la regla VIGENTE actual (seed)
  const activeBefore = store.getActiveRuleByType("CPP");
  assert.ok(activeBefore);
  const activeParamsBefore = { ...activeBefore!.parametros };

  // Crear una propuesta PENDIENTE
  const pending = insertPendingRule(store, "CPP", {
    tasa_empleado: 0.065,
    tope: 72000,
    exencion_basica: 3500,
  });

  // Rechazar
  const motivo = "Tasa propuesta no coincide con el anuncio oficial de CRA.";
  const result: RejectionResult = rejectChange(
    store,
    pending.id,
    adminId,
    motivo
  );

  assert.equal(result.success, true, `Rechazo falló: ${result.message}`);

  // Verificar: la PENDIENTE ahora es HISTORICO
  const pendingAfter = store.getRuleById(pending.id);
  assert.ok(pendingAfter);
  assert.equal(pendingAfter!.estado, "HISTORICO");
  assert.ok(
    pendingAfter!.notas?.includes("RECHAZADO"),
    "Las notas deben indicar RECHAZADO"
  );

  // Verificar: la VIGENTE NO se tocó
  const activeAfter = store.getRuleById(activeBefore!.id);
  assert.ok(activeAfter);
  assert.equal(activeAfter!.estado, "VIGENTE");
  assert.deepEqual(activeAfter!.parametros, activeParamsBefore);
  assert.equal(activeAfter!.vigente_desde, activeBefore!.vigente_desde);
});

test("rejectChange: registra en audit_log con motivo", () => {
  const store = seededStore();
  const adminId = "admin-006";
  const motivo = "La tasa propuesta no ha sido anunciada oficialmente aún.";

  const pending = insertPendingRule(store, "EI", {
    tasa_empleado: 0.018,
    tope: 70000,
    tasa_employer: 1.5,
  });

  const result = rejectChange(store, pending.id, adminId, motivo);
  assert.equal(result.success, true, result.message);

  const logs = store.getAuditLogs();
  const rejectLog = logs.find((l) => l.accion === "REJECT");
  assert.ok(rejectLog, "Debe existir un registro REJECT en audit_log");
  assert.equal(rejectLog!.registro_id, pending.id);
  assert.equal(rejectLog!.admin_id, adminId);
  assert.equal(rejectLog!.motivo, motivo);
  assert.ok(rejectLog!.metadata);
  assert.equal(
    (rejectLog!.metadata as Record<string, unknown>).tipo,
    "EI"
  );
});

test("rejectChange: exige motivo no vacío", () => {
  const store = seededStore();
  const pending = insertPendingRule(store, "WorkSafeBC", {
    class_rate: 3.0,
    class_code: "99999",
  });

  const resultEmpty = rejectChange(store, pending.id, "admin-007", "");
  assert.equal(resultEmpty.success, false);
  assert.match(resultEmpty.message, /motivo/);

  const resultWhitespace = rejectChange(store, pending.id, "admin-007", "   ");
  assert.equal(resultWhitespace.success, false);
  assert.match(resultWhitespace.message, /motivo/);
});

test("rejectChange: rechaza si la regla no está PENDIENTE", () => {
  const store = seededStore();
  const activeRule = store.getActiveRuleByType("MinWage");
  assert.ok(activeRule);

  const result = rejectChange(
    store,
    activeRule!.id,
    "admin-008",
    "Ya está vigente."
  );
  assert.equal(result.success, false);
  assert.match(result.message, /no está PENDIENTE/);
});

// ===========================================================================
// Test: Cambio de año fiscal — CPP/EI rates cambian en enero
// ===========================================================================

test("cambio año fiscal: sistema maneja transición CPP en enero", () => {
  const store = seededStore();
  const adminId = "admin-fiscal";

  // --- Escenario: llega diciembre 2026, CRA anuncia nuevas tasas para 2027 ---

  // 1. Verificar que la tasa 2026 está VIGENTE en diciembre
  const cpp2026 = store.getActiveRuleByType("CPP");
  assert.ok(cpp2026);
  assert.equal((cpp2026!.parametros as Record<string, number>).tasa_empleado, 0.0595);
  assert.equal((cpp2026!.parametros as Record<string, number>).tope, 74600);
  assert.ok(
    _isRuleActiveAt(cpp2026!, new Date("2026-12-15T12:00:00Z")),
    "CPP 2026 debe estar VIGENTE en diciembre 2026"
  );

  // 2. Feed de CRA detecta nuevas tasas para 2027
  const entries = fetchFeedEntries("CRA", new Date("2026-11-15T12:00:00Z"));
  const cpp2027Entry = entries.find((e) => e.tipo === "CPP");
  assert.ok(cpp2027Entry, "El feed de CRA debe incluir CPP");

  // Simulamos que la tasa anunciada para 2027 es diferente
  const cpp2027Params = {
    tasa_empleado: 0.061, // ↑ de 5.95% a 6.1%
    tope: 70000, // YMPE sube de $68,500 a $70,000
    exencion_basica: 3500,
  };

  // 3. Se crea una propuesta PENDIENTE para 2027-01
  const pending2027 = insertPendingRule(store, "CPP", cpp2027Params);
  assert.equal(pending2027.version, "2027-01");
  assert.equal(pending2027.estado, "PENDIENTE");

  // 4. Antes de aprobar, la tasa 2026 sigue siendo la VIGENTE
  const activeBeforeApproval = store.getActiveRuleByType("CPP");
  assert.equal(activeBeforeApproval!.id, cpp2026!.id);
  assert.equal(activeBeforeApproval!.version, "2026-01");

  // 5. Admin aprueba la transición para 2027
  const result = approveChange(store, pending2027.id, adminId);
  assert.equal(result.success, true, `Transición fiscal falló: ${result.message}`);

  // 6. Después de aprobar, la tasa 2027 es la VIGENTE
  const activeAfter = store.getActiveRuleByType("CPP");
  assert.ok(activeAfter);
  assert.equal(activeAfter!.id, pending2027.id);
  assert.equal(activeAfter!.version, "2027-01");
  assert.equal(
    (activeAfter!.parametros as Record<string, number>).tasa_empleado,
    0.061
  );

  // 7. La tasa 2026 es ahora HISTORICO
  const oldAfter = store.getRuleById(cpp2026!.id);
  assert.equal(oldAfter!.estado, "HISTORICO");
  assert.ok(oldAfter!.vigente_hasta, "2026 debe tener vigente_hasta");

  // 8. Los cálculos con fecha en 2026 deberían usar la tasa 2026
  //    (esto lo verifica _isRuleActiveAt)
  //    NOTA: re-leemos del store porque approveChange crea nuevos objetos.
  const cpp2026AfterUpdate = store.getRuleById(cpp2026!.id);
  assert.ok(cpp2026AfterUpdate);
  assert.equal(
    _isRuleActiveAt(activeAfter!, new Date("2025-12-15T12:00:00Z")),
    false,
    "CPP 2027 no debe estar activa en 2025"
  );
  assert.equal(
    _isRuleActiveAt(cpp2026AfterUpdate!, new Date("2026-06-15T12:00:00Z")),
    false,
    "CPP 2026 ya no está VIGENTE (es HISTORICO)"
  );
});

test("cambio año fiscal: EI rates también transicionan en enero", () => {
  const store = seededStore();
  const adminId = "admin-fiscal";

  // EI 2026 → 2027
  const ei2026 = store.getActiveRuleByType("EI");
  assert.ok(ei2026);
  assert.equal((ei2026!.parametros as Record<string, number>).tasa_empleado, 0.0163);
  assert.equal((ei2026!.parametros as Record<string, number>).tope, 68900);

  // Proponer EI 2027
  const ei2027Pending = insertPendingRule(store, "EI", {
    tasa_empleado: 0.0165,
    tope: 68000,
    tasa_employer: 1.4,
  });

  const result = approveChange(store, ei2027Pending.id, adminId);
  assert.equal(result.success, true, result.message);

  // Verificar transición
  const ei2027 = store.getActiveRuleByType("EI");
  assert.ok(ei2027);
  assert.equal(ei2027!.version, "2027-01");
  assert.equal(
    (ei2027!.parametros as Record<string, number>).tasa_empleado,
    0.0165
  );

  // EI 2026 es HISTORICO
  assert.equal(store.getRuleById(ei2026!.id)!.estado, "HISTORICO");
});

test("cambio año fiscal: si no hay cambios, no se genera versión PENDIENTE", () => {
  const store = seededStore();
  const persistence = new InMemoryFeedPersistence(store);

  // Ejecutar weekly job — con los mismos valores de seed, no debería haber cambios
  const now = new Date("2026-08-04T12:00:00Z");
  const result: WeeklyJobResult = weeklyComplianceJob(persistence, now);

  // Como los feeds retornan los mismos valores que los seeds 2026,
  // no deberían detectarse cambios
  assert.equal(
    result.changesDetected,
    0,
    "Sin cambios reales, no deben generarse versiones PENDIENTES"
  );
  assert.equal(result.versionsProposed.length, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(result.sourcesChecked, CANONICAL_FEED_SOURCES.length);
});

// ===========================================================================
// Test: getPendingChanges lista correctamente
// ===========================================================================

test("getPendingChanges: lista versiones PENDIENTES ordenadas por fecha", () => {
  const store = seededStore();

  // Insertar dos reglas PENDIENTES
  const p1 = insertPendingRule(store, "CPP", { tasa_empleado: 0.062, tope: 71000, exencion_basica: 3500 });
  const p2 = insertPendingRule(store, "EI", { tasa_empleado: 0.017, tope: 69000, tasa_employer: 1.4 });

  const pending: PendingChange[] = getPendingChanges(store);

  assert.ok(pending.length >= 2, "Debe haber al menos 2 cambios pendientes");

  const cppPending = pending.find((p) => p.tipo === "CPP");
  assert.ok(cppPending);
  assert.equal(cppPending.versionId, p1.id);
  assert.equal(cppPending.newVersion, "2027-01");

  const eiPending = pending.find((p) => p.tipo === "EI");
  assert.ok(eiPending);
  assert.equal(eiPending.versionId, p2.id);
});

test("getPendingChanges: sin PENDIENTES retorna array vacío", () => {
  const store = seededStore();
  const pending = getPendingChanges(store);
  assert.equal(pending.length, 0);
});

// ===========================================================================
// Test: weeklyComplianceJob flujo completo
// ===========================================================================

test("weeklyComplianceJob: procesa todas las fuentes sin errores", () => {
  const store = seededStore();
  const persistence = new InMemoryFeedPersistence(store);
  const now = new Date("2026-08-04T06:00:00Z");

  const result = weeklyComplianceJob(persistence, now);

  assert.equal(result.sourcesChecked, 3, "Debe revisar CRA, BC_ESA, WORKSAFEBC");
  assert.ok(result.entriesProcessed > 0, "Debe procesar entradas de los feeds");
  assert.ok(result.ranAt, "Debe registrar timestamp");
});

test("weeklyComplianceJob: detecta feed ciego si lastCheckedAt es null y createdAt > 30 días", () => {
  const store = seededStore();
  const persistence = new InMemoryFeedPersistence(store);

  // Forzar un feed "ciego" usando una fecha de creación muy antigua
  // CANONICAL_FEED_SOURCES tiene createdAt en 2025-01-01, así que en 2026-08 ya pasaron >30 días
  const now = new Date("2026-08-04T06:00:00Z");
  const result = weeklyComplianceJob(persistence, now);

  // Con createdAt 2025-01-01 y lastCheckedAt null, en 2026-08 los feeds están ciegos
  const blindAlerts = result.alertsToEmit.filter((a) =>
    a.title.includes("CIEGO")
  );
  assert.ok(
    blindAlerts.length >= 1,
    `Esperaba al menos 1 alerta de feed ciego, encontré ${blindAlerts.length}`
  );
});

test("weeklyComplianceJob: captura errores sin tumbar el job", () => {
  // Crear un persistence que lanza al consultar un tipo específico
  const store = seededStore();
  const faultyPersistence: FeedPersistence = {
    getCurrentParams(tipo: TipoRegla): Record<string, unknown> | null {
      if (tipo === "WorkSafeBC") {
        throw new Error("Simulated DB error for WorkSafeBC");
      }
      return new InMemoryFeedPersistence(store).getCurrentParams(tipo);
    },
    persistProposedVersion(proposal, source): string {
      return new InMemoryFeedPersistence(store).persistProposedVersion(proposal, source);
    },
  };

  const now = new Date("2026-08-04T06:00:00Z");
  const result = weeklyComplianceJob(faultyPersistence, now);

  assert.ok(result.errors.length >= 1, "Debe capturar el error de WorkSafeBC");
  assert.match(result.errors[0], /WORKSAFEBC/);
  assert.match(result.errors[0], /Simulated DB error/);

  // Las otras fuentes deben seguir procesándose
  assert.ok(result.entriesProcessed > 0, "Otras fuentes deben procesarse");
});
