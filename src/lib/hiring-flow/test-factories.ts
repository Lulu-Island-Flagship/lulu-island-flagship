// v0.4.1 (flujo de contratación / candidate hiring flow) -- Fase 2
// "Modelo de Datos Completo".
//
// Factories para generar datos VÁLIDOS falsos de cada entidad del modelo
// (types.ts), en memoria, sin tocar la DB. Pensadas para poder generar
// muchas instancias en una línea, ej.:
//
//   const candidates = Array.from({ length: 100 }, () => makeCandidate());
//
// Por qué este archivo vive en src/lib/hiring-flow/ y no en tests/: se
// eligió deliberadamente reusable-fuera-de-tests en vez de solo-tests.
// Motivo: estas mismas factories sirven para poblar datos de demo/seed
// en un entorno de desarrollo local (ej. un script `scripts/seed-dev.ts`
// que quiera insertar 50 candidatos falsos contra Supabase local para
// probar el dashboard de HR) sin duplicar la lógica de "qué es un
// candidato válido" en dos lugares. Si en el futuro se preferiera
// aislarlas estrictamente a tests, el único cambio necesario es mover
// este archivo a tests/lib/hiring-flow/test-factories.ts -- no dependen
// de ningún test runner (no usan expect/jest/vitest), solo de
// crypto.randomUUID() y Date, así que el movimiento sería mecánico.
// [ASSUMPTION] el enunciado deja el criterio abierto ("tu criterio, pero
// documenta la elección") -- esta es la justificación.
//
// Reglas de estas factories:
//   - Nunca tocan la red ni Supabase -- son objetos puros en memoria.
//   - Los valores por defecto SIEMPRE pasan las validaciones de
//     types.ts (isValidEmail, isValidCanadianPhone, etc.) para que un
//     test que no pasa `overrides` no falle por datos inválidos
//     "por accidente".
//   - `overrides` permite forzar cualquier campo (incluyendo valores
//     inválidos, para tests que exactamente prueban el caso inválido) --
//     se aplica siempre al final con spread.

import type {
  AccessCode,
  AccessCodePurpose,
  AuditLog,
  Candidate,
  CandidateAvailability,
  CandidateDocument,
  CandidateStatus,
  Communication,
  Consent,
  DayOfWeek,
  ElectronicSignature,
  FunnelEvent,
  HiringFlowSession,
  HrRole,
  HrUser,
  Position,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function makeId(): string {
  return crypto.randomUUID();
}

function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

let sequenceCounter = 0;
// Contador incremental para generar valores únicos y legibles (ej.
// "candidate-42@example.com") sin depender de una librería externa tipo
// faker -- este repo no la tiene como dependencia y no vale la pena
// agregarla solo para estas factories. [ASSUMPTION].
function nextSequence(): number {
  sequenceCounter += 1;
  return sequenceCounter;
}

const FIRST_NAMES = ["Ana", "Luis", "María", "Carlos", "Sofía", "Diego", "Valentina", "Jorge"];
const LAST_NAMES = ["García", "Martínez", "López", "Hernández", "Rodríguez", "Pérez", "Sánchez"];

function pick<T>(items: readonly T[], seed: number): T {
  return items[seed % items.length];
}

// ---------------------------------------------------------------------------
// positions (256)
// ---------------------------------------------------------------------------

export function makePosition(overrides: Partial<Position> = {}): Position {
  const n = nextSequence();
  const now = isoNow();
  return {
    id: makeId(),
    slug: `posicion-de-prueba-${n}`,
    title: `Posición de prueba ${n}`,
    description: "Descripción generada por test-factories, no representa una vacante real.",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// candidates (257)
// ---------------------------------------------------------------------------

export function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  const n = nextSequence();
  const now = isoNow();
  const firstName = pick(FIRST_NAMES, n);
  const lastName = pick(LAST_NAMES, n);
  const status: CandidateStatus = "step1_completed";
  return {
    id: makeId(),
    positionId: makeId(),
    firstName,
    lastName,
    email: `candidato.prueba.${n}@example.com`,
    phone: "6045550" + String(100 + (n % 900)).padStart(3, "0"),
    dateOfBirth: "1995-06-15",
    status,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// candidate_availability (258)
// ---------------------------------------------------------------------------

export function makeCandidateAvailability(
  overrides: Partial<CandidateAvailability> = {}
): CandidateAvailability {
  const n = nextSequence();
  const dayOfWeek = (n % 7) as DayOfWeek;
  return {
    id: makeId(),
    candidateId: makeId(),
    dayOfWeek,
    startTime: "09:00:00",
    endTime: "17:00:00",
    createdAt: isoNow(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// access_codes (259)
// ---------------------------------------------------------------------------

export function makeAccessCode(overrides: Partial<AccessCode> = {}): AccessCode {
  const n = nextSequence();
  const purpose: AccessCodePurpose = n % 2 === 0 ? "step2" : "step3";
  return {
    id: makeId(),
    candidateId: makeId(),
    // Hash falso con forma plausible de un hash real -- nunca un código
    // en texto plano de 4-6 dígitos, a propósito (ver comentario de
    // cabecera de la migración 259: nunca se persiste el código crudo,
    // ni siquiera en datos de prueba, para no normalizar el hábito).
    codeHash: `fake-hash-${n}-${makeId()}`,
    purpose,
    expiresAt: isoNow(15 * 60 * 1000), // +15 min, [ASSUMPTION] TTL de ejemplo
    usedAt: null,
    createdAt: isoNow(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sessions (260)
// ---------------------------------------------------------------------------

export function makeSession(overrides: Partial<HiringFlowSession> = {}): HiringFlowSession {
  const n = nextSequence();
  const now = isoNow();
  return {
    id: makeId(),
    candidateId: makeId(),
    tokenHash: `fake-token-hash-${n}-${makeId()}`,
    expiresAt: isoNow(30 * 60 * 1000), // +30 min, [ASSUMPTION] TTL de ejemplo
    lastActivityAt: now,
    invalidatedAt: null,
    createdAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// documents (261)
// ---------------------------------------------------------------------------

export function makeCandidateDocument(overrides: Partial<CandidateDocument> = {}): CandidateDocument {
  const n = nextSequence();
  return {
    id: makeId(),
    candidateId: makeId(),
    documentType: "identification",
    storagePath: `hiring-flow/candidates/fake-${n}/id.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 102_400 + n,
    uploadedAt: isoNow(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// electronic_signatures (262)
// ---------------------------------------------------------------------------

export function makeElectronicSignature(
  overrides: Partial<ElectronicSignature> = {}
): ElectronicSignature {
  const n = nextSequence();
  return {
    id: makeId(),
    candidateId: makeId(),
    documentReference: `offer-letter-v1-${n}`,
    documentHash: `fake-document-hash-${n}-${makeId()}`,
    signedAt: isoNow(),
    ipAddress: "203.0.113.10", // TEST-NET-3 (RFC 5737) -- IP reservada para documentación/pruebas
    userAgent: "Mozilla/5.0 (test-factories fake user agent)",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// consents (263)
// ---------------------------------------------------------------------------

export function makeConsent(overrides: Partial<Consent> = {}): Consent {
  const n = nextSequence();
  return {
    id: makeId(),
    candidateId: makeId(),
    legalTextKey: "pipa-bc-notice",
    legalTextVersion: `v1.${n}`,
    legalTextId: makeId(),
    accepted: true,
    ipAddress: "203.0.113.11",
    userAgent: "Mozilla/5.0 (test-factories fake user agent)",
    createdAt: isoNow(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hr_users (264)
// ---------------------------------------------------------------------------

export function makeHrUser(overrides: Partial<HrUser> = {}): HrUser {
  const n = nextSequence();
  const role: HrRole = n % 2 === 0 ? "recruiter" : "hr_admin";
  return {
    id: makeId(),
    authUserId: makeId(),
    fullName: `${pick(FIRST_NAMES, n)} ${pick(LAST_NAMES, n)}`,
    role,
    active: true,
    createdAt: isoNow(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// audit_logs (265)
// ---------------------------------------------------------------------------

export function makeAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: makeId(),
    actorType: "hr_user",
    actorId: makeId(),
    action: "candidate.status_changed",
    entityType: "candidate",
    entityId: makeId(),
    metadata: { note: "generado por test-factories" },
    createdAt: isoNow(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// communications (266)
// ---------------------------------------------------------------------------

export function makeCommunication(overrides: Partial<Communication> = {}): Communication {
  return {
    id: makeId(),
    candidateId: makeId(),
    channel: "sms",
    templateKey: "access-code-step2",
    status: "queued",
    sentAt: null,
    createdAt: isoNow(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// funnel_events (267)
// ---------------------------------------------------------------------------

export function makeFunnelEvent(overrides: Partial<FunnelEvent> = {}): FunnelEvent {
  return {
    id: makeId(),
    candidateId: makeId(),
    eventType: "status_changed",
    fromStatus: "step1_completed",
    toStatus: "step2_completed",
    createdAt: isoNow(),
    ...overrides,
  };
}
