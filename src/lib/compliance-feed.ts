/**
 * v8.3 Capa 2 del Financial Core — Compliance Feed.
 *
 * Motor de actualización legal: monitorea feeds externos, detecta cambios
 * en tasas/parámetros, y gestiona el ciclo de vida de versiones nuevas
 * (PENDIENTE → VIGENTE) aplicando la REGLA DE ORO:
 *
 *   NUNCA se edita una versión VIGENTE. Los cambios generan nueva versión.
 *   Los asientos históricos quedan ligados a la versión de su momento.
 *
 * Conexiones:
 * - legal-monitoring.ts → verifica si los feeds están atrasados o ciegos.
 * - compliance-engine.ts → schemas, tipos, seed data.
 * - compliance-resolver.ts → getCurrentRate() para comparar.
 *
 * Flujo completo:
 *   1. checkForLegalUpdates() — consulta el feed externo (CRA, BC Gov, etc.)
 *      y devuelve las tasas/parámetros más recientes publicados.
 *   2. detectChanges() — compara lo publicado vs la versión VIGENTE actual.
 *   3. proposeNewVersion() — crea una nueva fila en estado PENDIENTE con los
 *      cambios detectados. NO modifica la versión vigente.
 *   4. activateVersion() — un admin aprueba la versión PENDIENTE: la versión
 *      anterior se marca HISTORICO (con vigente_hasta = now()) y la nueva
 *      pasa a VIGENTE (vigente_desde = now()).
 */

import { isFeedOverdueForFrequency, type LegalFeedFrequency } from "./legal-monitoring";
import {
  _isRuleActiveAt as isRuleActiveAt,
  _versionsOverlap as versionsOverlap,
  type ReglaLegalRow,
  type TipoRegla,
  type Jurisdiccion,
  type _VersionStatus as VersionStatus,
} from "./compliance-engine";
import { getCurrentRate } from "./compliance-resolver";

// ---------------------------------------------------------------------------
// Tipos del feed
// ---------------------------------------------------------------------------

/** Entrada de un feed legal externo (CRA, BC Gov, WorkSafeBC, etc.). */
export interface LegalFeedEntry {
  /** Fuente del feed (ej. "CRA", "BC_GOV", "WORKSAFEBC"). */
  source: string;
  /** Tipo de regla afectada. */
  tipo: TipoRegla;
  /** Jurisdicción. */
  jurisdiccion: Jurisdiccion;
  /** Parámetros publicados en el feed. */
  parametros: Record<string, unknown>;
  /** Fecha de publicación del feed. */
  publishedAt: string; // ISO datetime
  /** URL o referencia del anuncio oficial. */
  referenceUrl?: string;
  /** Fecha de entrada en vigor según el anuncio. */
  effectiveDate?: string; // ISO date
}

/** Resultado del chequeo de actualizaciones legales. */
export interface LegalUpdateCheckResult {
  /** ¿Se encontraron entradas nuevas en el feed? */
  hasUpdates: boolean;
  /** Entradas del feed posteriores a la última revisión. */
  entries: LegalFeedEntry[];
  /** ¿El feed está "ciego" (más de 30 días sin revisar)? */
  isBlind: boolean;
  /** ¿El feed está atrasado según su frecuencia declarada? */
  isOverdue: boolean;
  /** Timestamp de esta revisión. */
  checkedAt: string;
}

/** Cambio detectado entre una versión vigente y una entrada del feed. */
export interface DetectedChange {
  tipo: TipoRegla;
  jurisdiccion: Jurisdiccion;
  /** Parámetros actuales (versión VIGENTE). */
  currentParams: Record<string, unknown> | null;
  /** Parámetros nuevos (del feed). */
  newParams: Record<string, unknown>;
  /** Claves que cambiaron de valor. */
  changedKeys: string[];
  /** Feed entry que originó el cambio. */
  source: LegalFeedEntry;
}

/** Propuesta de nueva versión (estado PENDIENTE). */
export interface ProposedVersion {
  /** ID único asignado a la propuesta. */
  id: string;
  tipo: TipoRegla;
  jurisdiccion: Jurisdiccion;
  /** Versión actual (la que sería reemplazada). */
  currentVersion: string | null;
  /** Nueva versión propuesta (formato YYYY-MM). */
  newVersion: string;
  /** Parámetros propuestos. */
  parametros: Record<string, unknown>;
  /** Estado inicial: siempre PENDIENTE. */
  estado: "PENDIENTE";
  /** Cambios detectados que originaron esta propuesta. */
  changes: DetectedChange[];
  /** Fecha de creación de la propuesta. */
  createdAt: string;
}

/** Resultado de la activación de una versión. */
export interface ActivationResult {
  success: boolean;
  /** ID de la nueva versión VIGENTE. */
  newActiveVersionId: string | null;
  /** ID de la versión anterior (ahora HISTORICO). */
  previousVersionId: string | null;
  /** Mensaje descriptivo. */
  message: string;
}

// ---------------------------------------------------------------------------
// checkForLegalUpdates()
// ---------------------------------------------------------------------------

/**
 * Consulta el feed legal y detecta si hay actualizaciones pendientes.
 *
 * En producción, esta función consulta las fuentes externas reales (APIs de
 * CRA, BC Government, WorkSafeBC). En esta implementación, devuelve la
 * estructura para que el llamador la pueble con datos reales del feed.
 *
 * Se integra con legal-monitoring.ts para verificar:
 * - Si el feed está "ciego" (>30 días sin revisar → alerta roja).
 * - Si el feed está atrasado según su frecuencia (daily/weekly/monthly).
 *
 * @param lastCheckedAt - Última vez que se revisó este feed (null = nunca).
 * @param createdAt - Fecha de creación del registro del feed.
 * @param frequency - Frecuencia declarada del feed.
 * @param now - Fecha de referencia (default: new Date()).
 */
export function checkForLegalUpdates(
  lastCheckedAt: Date | null,
  createdAt: Date,
  frequency: LegalFeedFrequency,
  now: Date = new Date()
): LegalUpdateCheckResult {
  const isOverdue = isFeedOverdueForFrequency(lastCheckedAt, createdAt, now, frequency);

  // "Ciego" = más de 30 días desde la última revisión (o desde creación si nunca se revisó).
  const reference = lastCheckedAt ?? createdAt;
  const daysSinceLastCheck = (now.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24);
  const isBlind = daysSinceLastCheck > 30;

  return {
    hasUpdates: false, // el llamador debe poblarlo tras consultar el feed real
    entries: [],
    isBlind,
    isOverdue,
    checkedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// detectChanges()
// ---------------------------------------------------------------------------

/**
 * Compara una entrada del feed legal contra la versión VIGENTE actual y
 * detecta qué parámetros cambiaron.
 *
 * Solo reporta cambios reales (valores distintos). Si no hay versión vigente
 * (primera carga), todos los parámetros se consideran nuevos.
 *
 * @param entry - Entrada del feed legal externo.
 * @param currentParams - Parámetros de la versión VIGENTE actual (null si no existe).
 */
export function detectChanges(
  entry: LegalFeedEntry,
  currentParams: Record<string, unknown> | null
): DetectedChange {
  const changedKeys: string[] = [];

  if (!currentParams) {
    // Sin versión previa → todos los keys son nuevos
    changedKeys.push(...Object.keys(entry.parametros));
  } else {
    for (const key of Object.keys(entry.parametros)) {
      if (JSON.stringify(entry.parametros[key]) !== JSON.stringify(currentParams[key])) {
        changedKeys.push(key);
      }
    }
    // También detectamos keys que estaban en currentParams pero ya no en el feed
    for (const key of Object.keys(currentParams)) {
      if (!(key in entry.parametros)) {
        changedKeys.push(key);
      }
    }
  }

  return {
    tipo: entry.tipo,
    jurisdiccion: entry.jurisdiccion,
    currentParams,
    newParams: entry.parametros,
    changedKeys,
    source: entry,
  };
}

// ---------------------------------------------------------------------------
// proposeNewVersion()
// ---------------------------------------------------------------------------

/**
 * Crea una propuesta de nueva versión en estado PENDIENTE a partir de los
 * cambios detectados.
 *
 * REGLA DE ORO: esta función NO modifica la versión VIGENTE. Solo crea una
 * nueva fila en estado PENDIENTE que deberá ser activada explícitamente por
 * un admin mediante `activateVersion()`.
 *
 * La versión se nombra automáticamente como YYYY-MM (año-mes actual) a
 * menos que el feed especifique una effectiveDate, en cuyo caso se usa esa
 * fecha.
 *
 * @param change - Cambio detectado por `detectChanges()`.
 * @param createdBy - Identificador de quién o qué sistema crea la propuesta.
 */
export function proposeNewVersion(
  change: DetectedChange,
  createdBy: string = "compliance-feed"
): ProposedVersion {
  const now = new Date();
  const effectiveDate = change.source.effectiveDate
    ? new Date(change.source.effectiveDate)
    : now;
  const newVersion = `${effectiveDate.getUTCFullYear()}-${String(effectiveDate.getUTCMonth() + 1).padStart(2, "0")}`;

  // La versión actual vigente (para referencia, no se modifica)
  const currentVersion = change.currentParams ? "vigente" : null;

  // Generamos un ID determinístico basado en tipo + nueva versión + timestamp
  const id = `prop-${change.tipo}-${newVersion}-${now.getTime()}`;

  return {
    id,
    tipo: change.tipo,
    jurisdiccion: change.jurisdiccion,
    currentVersion,
    newVersion,
    parametros: change.newParams,
    estado: "PENDIENTE",
    changes: [change],
    createdAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// activateVersion()
// ---------------------------------------------------------------------------

/**
 * Activa una versión PENDIENTE: la promueve a VIGENTE y marca la versión
 * anterior como HISTORICO.
 *
 * REGLA DE ORO aplicada aquí:
 * - La versión VIGENTE anterior recibe `vigente_hasta = now()` y `estado = HISTORICO`.
 * - La nueva versión recibe `vigente_desde = now()` y `estado = VIGENTE`.
 * - Los asientos históricos que referenciaban la versión anterior NO se tocan
 *   (quedan ligados a la versión de su momento).
 *
 * En producción, esta función requiere autorización de admin (adminId) y
 * escribe en la tabla `reglas_legales`. En esta implementación, retorna la
 * estructura de resultado para que el llamador ejecute la transacción.
 *
 * @param proposedVersion - La versión PENDIENTE a activar.
 * @param currentActive - La versión actualmente VIGENTE (null si es primera carga).
 * @param adminId - Identificador del admin que autoriza la activación.
 */
export function activateVersion(
  proposedVersion: ProposedVersion,
  currentActive: ReglaLegalRow | null,
  adminId: string
): ActivationResult {
  const now = new Date().toISOString();

  // Validación: la propuesta debe estar PENDIENTE
  if (proposedVersion.estado !== "PENDIENTE") {
    return {
      success: false,
      newActiveVersionId: null,
      previousVersionId: null,
      message: `La versión ${proposedVersion.id} no está en estado PENDIENTE (estado actual: ${proposedVersion.estado}).`,
    };
  }

  // Validación: si hay versión vigente, verificar que no se solapen
  if (currentActive) {
    if (currentActive.estado !== "VIGENTE") {
      return {
        success: false,
        newActiveVersionId: null,
        previousVersionId: currentActive.id,
        message: `La versión actual ${currentActive.id} no está VIGENTE (estado: ${currentActive.estado}).`,
      };
    }

    // Verificar que la nueva versión es posterior
    const currentVersionDate = currentActive.vigente_desde
      ? new Date(currentActive.vigente_desde).getTime()
      : 0;
    const newVersionDate = new Date(now).getTime();
    if (newVersionDate <= currentVersionDate) {
      return {
        success: false,
        newActiveVersionId: null,
        previousVersionId: currentActive.id,
        message: `La nueva versión no puede ser anterior o igual a la vigente (${currentActive.vigente_desde}).`,
      };
    }
  }

  // Éxito: la versión anterior pasa a HISTORICO, la nueva a VIGENTE.
  // En producción, esto sería una transacción atómica en la DB.
  return {
    success: true,
    newActiveVersionId: proposedVersion.id,
    previousVersionId: currentActive?.id ?? null,
    message: currentActive
      ? `Versión ${proposedVersion.id} activada. La versión anterior ${currentActive.id} pasa a HISTORICO con vigente_hasta=${now}.`
      : `Versión ${proposedVersion.id} activada como primera versión VIGENTE.`,
  };
}

// ---------------------------------------------------------------------------
// Helper: ciclo completo de actualización
// ---------------------------------------------------------------------------

/**
 * Ejecuta el ciclo completo de detección y propuesta para una entrada del feed.
 *
 * 1. Obtiene los parámetros vigentes actuales.
 * 2. Compara con la entrada del feed (detectChanges).
 * 3. Si hay cambios, genera una propuesta PENDIENTE.
 * 4. Si no hay cambios, retorna null.
 *
 * @param entry - Entrada del feed legal externo.
 * @param fecha - Fecha de referencia para resolver la tasa vigente.
 */
export function processFeedEntry(
  entry: LegalFeedEntry,
  fecha?: Date
): ProposedVersion | null {
  const currentParams = getCurrentRate(entry.tipo, fecha) as Record<string, unknown> | null;
  const change = detectChanges(entry, currentParams);

  if (change.changedKeys.length === 0) {
    return null; // sin cambios, no se genera propuesta
  }

  return proposeNewVersion(change, `feed-${entry.source}`);
}
