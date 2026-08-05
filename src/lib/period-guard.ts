/**
 * v8.3 — Capa 3 del Financial Core: Period Guard.
 *
 * Middleware de validación que protege la integridad de los períodos contables.
 * Todo INSERT/UPDATE en `financial_ledger` debe pasar por estas guardas antes
 * de tocar la base de datos.
 *
 * Guards puras: reciben el estado actual del período (ya leído por el caller)
 * y deciden. No hacen queries. Si el caller no consultó el estado del período
 * antes de intentar escribir, la culpa es del caller.
 *
 * Jerarquía de enforcement (defense in depth):
 *   1. TypeScript guard (este archivo) — primera línea, error descriptivo antes
 *      de llegar a la DB. Falla fast.
 *   2. PostgreSQL trigger (comentario abajo) — última línea, rechaza en la DB
 *      incluso si alguien puentea la capa TypeScript. Falla safe.
 *
 * Reglas:
 *   - ABIERTO:    INSERT/UPDATE permitidos sin restricción.
 *   - BLOQUEADO:  INSERT/UPDATE SOLO con override explícito de admin + motivo
 *                 registrado en audit_log. Sin override → error.
 *   - CERRADO:    INSERT/UPDATE PROHIBIDOS. Inmutable de verdad. La corrección
 *                 se hace vía asiento de reversión en el mes ACTUAL.
 *   - ARCHIVADO:  solo lectura. Todo INSERT/UPDATE PROHIBIDO.
 */

import {
  type PeriodoContableEstado,
  PERIODO_ESTADOS,
  periodoSchema,
  getCurrentPeriodo,
} from "@/lib/accounting-period";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Error base para violaciones de período contable.
 * Todas las subclases llevan el período, el estado actual, y la acción intentada.
 */
export class PeriodoContableError extends Error {
  public readonly periodo: string;
  public readonly estadoActual: PeriodoContableEstado;
  public readonly accionIntentada: string;

  constructor(
    periodo: string,
    estadoActual: PeriodoContableEstado,
    accionIntentada: string,
    message: string,
  ) {
    super(message);
    this.name = "PeriodoContableError";
    this.periodo = periodo;
    this.estadoActual = estadoActual;
    this.accionIntentada = accionIntentada;
  }
}

/** El período está BLOQUEADO y la operación no trae override de admin. */
export class PeriodoBloqueadoError extends PeriodoContableError {
  constructor(periodo: string, accionIntentada: string) {
    super(
      periodo,
      "BLOQUEADO",
      accionIntentada,
      `Período ${periodo} está BLOQUEADO. Se requiere override explícito de admin con motivo registrado en audit_log para ejecutar "${accionIntentada}".`,
    );
    this.name = "PeriodoBloqueadoError";
  }
}

/** El período está CERRADO y es inmutable. */
export class PeriodoCerradoError extends PeriodoContableError {
  constructor(periodo: string, accionIntentada: string) {
    super(
      periodo,
      "CERRADO",
      accionIntentada,
      `Período ${periodo} está CERRADO y es inmutable. No se puede ejecutar "${accionIntentada}". Use asiento de reversión en el mes actual.`,
    );
    this.name = "PeriodoCerradoError";
  }
}

/** El período está ARCHIVADO. Solo lectura. */
export class PeriodoArchivadoError extends PeriodoContableError {
  constructor(periodo: string, accionIntentada: string) {
    super(
      periodo,
      "ARCHIVADO",
      accionIntentada,
      `Período ${periodo} está ARCHIVADO (solo lectura, retención 7 años). No se puede ejecutar "${accionIntentada}".`,
    );
    this.name = "PeriodoArchivadoError";
  }
}

/** El período no existe en la tabla periodo_contable. */
export class PeriodoNoExisteError extends PeriodoContableError {
  constructor(periodo: string, accionIntentada: string) {
    super(
      periodo,
      "ABIERTO" as PeriodoContableEstado, // placeholder — no hay estado real
      accionIntentada,
      `Período ${periodo} no existe en periodo_contable. Debe crearse antes de registrar asientos.`,
    );
    this.name = "PeriodoNoExisteError";
  }
}

// ---------------------------------------------------------------------------
// Guard functions (pure)
// ---------------------------------------------------------------------------

export interface AssertPeriodoAbiertoInput {
  /** Período contable que se intenta modificar (YYYY-MM). */
  periodo: string;
  /** Estado actual del período (leído de la DB por el caller). */
  estado: PeriodoContableEstado | null;
  /** Descripción de la acción que se intenta ejecutar (para mensajes de error). */
  accion: string;
  /**
   * Si es true, se permite escribir en un período BLOQUEADO.
   * El caller DEBE registrar el motivo en audit_log — esta guarda no lo
   * verifica (separación de concerns: el caller es responsable de la auditoría).
   */
  overrideAdmin?: boolean;
}

/**
 * Afirma que un período está en estado que permite escrituras.
 *
 * - `estado === null` → el período no existe en periodo_contable → lanza PeriodoNoExisteError
 * - `ABIERTO` → OK, no lanza
 * - `BLOQUEADO` + `overrideAdmin` → OK, no lanza (el caller debe auditarlo)
 * - `BLOQUEADO` sin override → lanza PeriodoBloqueadoError
 * - `CERRADO` → lanza PeriodoCerradoError (inmutable de verdad)
 * - `ARCHIVADO` → lanza PeriodoArchivadoError
 *
 * @throws PeriodoContableError (o subclase) si la escritura no está permitida.
 */
export function assertPeriodoAbierto(input: AssertPeriodoAbiertoInput): void {
  // Validar formato del período
  const periodo = periodoSchema.parse(input.periodo);

  if (input.estado === null) {
    throw new PeriodoNoExisteError(periodo, input.accion);
  }

  // Validar que el estado es uno de los conocidos
  if (!PERIODO_ESTADOS.includes(input.estado)) {
    throw new PeriodoContableError(
      periodo,
      input.estado,
      input.accion,
      `Estado desconocido "${input.estado}" para período ${periodo}.`,
    );
  }

  // ABIERTO: siempre OK
  if (input.estado === "ABIERTO") {
    return;
  }

  // BLOQUEADO: solo con override explícito
  if (input.estado === "BLOQUEADO") {
    if (input.overrideAdmin) {
      return; // OK — el caller es responsable de registrar en audit_log
    }
    throw new PeriodoBloqueadoError(periodo, input.accion);
  }

  // CERRADO: inmutable de verdad. NUNCA se permite escritura directa.
  if (input.estado === "CERRADO") {
    throw new PeriodoCerradoError(periodo, input.accion);
  }

  // ARCHIVADO: solo lectura
  if (input.estado === "ARCHIVADO") {
    throw new PeriodoArchivadoError(periodo, input.accion);
  }
}

/**
 * Versión booleana de `assertPeriodoAbierto`. No lanza, retorna true/false.
 * Útil para validación previa sin try/catch.
 */
export function isPeriodoAbierto(estado: PeriodoContableEstado | null): boolean {
  return estado === "ABIERTO";
}

/**
 * Versión booleana: ¿permite escrituras este estado?
 * (ABIERTO siempre, BLOQUEADO con override)
 */
export function allowsWrite(
  estado: PeriodoContableEstado | null,
  overrideAdmin?: boolean,
): boolean {
  if (estado === null) return false;
  if (estado === "ABIERTO") return true;
  if (estado === "BLOQUEADO" && overrideAdmin) return true;
  return false;
}

// ---------------------------------------------------------------------------
// getPeriodoActual
// ---------------------------------------------------------------------------

/**
 * Retorna el período contable actual (YYYY-MM) basado en la fecha UTC actual.
 *
 * Esta es una re-exportación de `getCurrentPeriodo` de accounting-period.ts
 * con un nombre más semántico para el contexto de guard.
 *
 * @param now — fecha actual para el cálculo (testeable, default = new Date())
 */
export { getCurrentPeriodo as getPeriodoActual } from "@/lib/accounting-period";

// ---------------------------------------------------------------------------
// Pre-INSERT validation for financial_ledger
// ---------------------------------------------------------------------------

export interface ValidateLedgerInsertInput {
  /** Período al que pertenece el asiento (YYYY-MM). */
  periodo: string;
  /** Estado actual del período en periodo_contable (leído por el caller). */
  estadoPeriodo: PeriodoContableEstado | null;
  /** Si es true, se permite insertar en BLOQUEADO (con auditoría obligatoria). */
  overrideAdmin?: boolean;
  /** Motivo del override (obligatorio si overrideAdmin === true). */
  motivoOverride?: string;
}

export interface ValidateLedgerInsertResult {
  /** true si el INSERT es válido. */
  allowed: boolean;
  /** Si no es allowed, el error que se debe lanzar o retornar al cliente. */
  error: PeriodoContableError | null;
  /**
   * Si es BLOQUEADO + override, este flag indica que el caller DEBE registrar
   * la entrada de auditoría (asiento_override_bloqueado) antes o junto con el INSERT.
   */
  requiresAuditEntry: boolean;
}

/**
 * Valida si un INSERT en `financial_ledger` es permitido según el estado del período.
 *
 * A diferencia de `assertPeriodoAbierto`, esta función no lanza — retorna
 * un resultado estructurado para que el caller decida cómo manejar el error
 * (útil en APIs que devuelven JSON en vez de lanzar excepciones).
 *
 * Reglas:
 *   - Período no existe → no permitido
 *   - ABIERTO → permitido sin restricciones
 *   - BLOQUEADO + overrideAdmin → permitido, requiresAuditEntry = true
 *   - BLOQUEADO sin override → no permitido
 *   - CERRADO → no permitido (inmutable de verdad)
 *   - ARCHIVADO → no permitido
 */
export function validateLedgerInsert(
  input: ValidateLedgerInsertInput,
): ValidateLedgerInsertResult {
  try {
    assertPeriodoAbierto({
      periodo: input.periodo,
      estado: input.estadoPeriodo,
      accion: "INSERT en financial_ledger",
      overrideAdmin: input.overrideAdmin,
    });

    // Si llegamos aquí, el INSERT está permitido
    const requiresAuditEntry = input.estadoPeriodo === "BLOQUEADO" && input.overrideAdmin === true;

    return { allowed: true, error: null, requiresAuditEntry };
  } catch (err) {
    if (err instanceof PeriodoContableError) {
      return { allowed: false, error: err, requiresAuditEntry: false };
    }
    // ZodError u otro error inesperado
    throw err;
  }
}

/*
 * =========================================================================
 * POSTGRESQL TRIGGER — Última línea de defensa
 * =========================================================================
 *
 * El siguiente trigger se ejecuta ANTES de cualquier INSERT en la tabla
 * `financial_ledger`. Si el período está BLOQUEADO o CERRADO, rechaza la
 * operación a nivel de base de datos — incluso si alguien puentea la capa
 * TypeScript (migración directa, consola SQL, otro servicio).
 *
 * El trigger respeta el override de admin mediante una variable de sesión
 * (`app.skip_period_guard`) que solo el service_role puede setear. Esto
 * permite que la API de admin (previa autenticación y registro de auditoría)
 * fuerce escrituras en BLOQUEADO, pero nadie más.
 *
 * MIGRACIÓN SUGERIDA (ej. 3XX_period_guard_trigger.sql):
 *
 * ```sql
 * -- =========================================================================
 * -- Trigger: financial_ledger_period_guard
 * -- Rechaza INSERT/UPDATE en financial_ledger si el período no está ABIERTO.
 * -- Respeta override vía app.skip_period_guard (solo service_role).
 * -- =========================================================================
 *
 * CREATE OR REPLACE FUNCTION financial_ledger_period_guard_fn()
 * RETURNS TRIGGER AS $$
 * DECLARE
 *   v_estado TEXT;
 *   v_skip    TEXT;
 * BEGIN
 *   -- Si el override está activo (solo service_role puede setearlo), permitir.
 *   v_skip := NULLIF(current_setting('app.skip_period_guard', true), '');
 *   IF v_skip = 'true' THEN
 *     RETURN NEW;
 *   END IF;
 *
 *   -- Buscar el estado del período en periodo_contable.
 *   SELECT estado INTO v_estado
 *   FROM periodo_contable
 *   WHERE periodo = NEW.periodo;
 *
 *   -- Si el período no existe en periodo_contable, rechazar.
 *   -- Todo asiento debe pertenecer a un período contable registrado.
 *   IF v_estado IS NULL THEN
 *     RAISE EXCEPTION 'Período % no existe en periodo_contable. Cree el período antes de registrar asientos.',
 *       NEW.periodo;
 *   END IF;
 *
 *   -- ABIERTO: siempre permitido.
 *   IF v_estado = 'ABIERTO' THEN
 *     RETURN NEW;
 *   END IF;
 *
 *   -- BLOQUEADO: solo con override (ya chequeado arriba).
 *   IF v_estado = 'BLOQUEADO' THEN
 *     RAISE EXCEPTION 'Período % está BLOQUEADO. Se requiere override explícito de admin (app.skip_period_guard).',
 *       NEW.periodo;
 *   END IF;
 *
 *   -- CERRADO: inmutable. NUNCA se permite escritura directa, ni con override.
 *   IF v_estado = 'CERRADO' THEN
 *     RAISE EXCEPTION 'Período % está CERRADO y es inmutable. Use asiento de reversión en el mes actual.',
 *       NEW.periodo;
 *   END IF;
 *
 *   -- ARCHIVADO: solo lectura.
 *   IF v_estado = 'ARCHIVADO' THEN
 *     RAISE EXCEPTION 'Período % está ARCHIVADO (solo lectura).',
 *       NEW.periodo;
 *   END IF;
 *
 *   RETURN NEW;
 * END;
 * $$ LANGUAGE plpgsql SECURITY DEFINER;
 *
 * -- Aplicar el trigger a financial_ledger (INSERT y UPDATE).
 * DROP TRIGGER IF EXISTS trg_financial_ledger_period_guard ON financial_ledger;
 * CREATE TRIGGER trg_financial_ledger_period_guard
 *   BEFORE INSERT OR UPDATE ON financial_ledger
 *   FOR EACH ROW
 *   EXECUTE FUNCTION financial_ledger_period_guard_fn();
 *
 * -- La columna `periodo` debe existir en financial_ledger.
 * -- Si no existe, agregarla con:
 * --   ALTER TABLE financial_ledger ADD COLUMN periodo TEXT NOT NULL;
 *
 * -- Índice para búsqueda rápida del trigger:
 * --   CREATE INDEX IF NOT EXISTS idx_financial_ledger_periodo
 * --     ON financial_ledger(periodo);
 * ```
 *
 * USO DEL OVERRIDE DESDE LA API (TypeScript):
 *
 * ```typescript
 * // Solo en rutas admin autenticadas con requireAdminRole()
 * const sb = getServiceRoleClient();
 * await sb.rpc('set_config', { parameter: 'app.skip_period_guard', value: 'true' });
 * // ... INSERT en financial_ledger ...
 * await sb.rpc('set_config', { parameter: 'app.skip_period_guard', value: '' });
 * ```
 */
