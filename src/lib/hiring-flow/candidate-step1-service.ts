import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "./settings-service";
import { getPublicPosition, PositionNotFoundError } from "./positions-service";
import { validateStep1, type Step1Input, type Step1ValidationError } from "./step1-validator";
import { renderLegalText } from "./legal-text-service";
import { issueAccessCode, type AccessCodePurpose } from "./access-code-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 4.4: Generación de Código Paso 2 (orquesta el submit
// completo del Paso 1: valida input, crea el candidato, registra su
// consentimiento legal y emite el código de acceso al Paso 2).
//
// Tabla asumida (ver supabase/migrations/257_hiring_flow_candidates.sql,
// Fase 2, creada en paralelo -- NO se crea ni se stubea aquí):
//   candidates(
//     id UUID,
//     position_id UUID,
//     first_name TEXT,
//     last_name TEXT,
//     email TEXT,
//     phone TEXT,
//     date_of_birth DATE,
//     status TEXT DEFAULT 'step1_completed',
//     created_at TIMESTAMPTZ,
//     updated_at TIMESTAMPTZ
//   )
//
// Tabla asumida (auditoría de embudo, NO tiene migración todavía al
// momento de escribir este archivo -- ver nota de atomicidad más abajo
// sobre por qué esto es aceptable de todos modos, dado que el insert es
// best-effort):
//   funnel_events(
//     id UUID,
//     candidate_id UUID,
//     event_type TEXT,
//     from_status TEXT,
//     to_status TEXT,
//     created_at TIMESTAMPTZ
//   )
//
// PIPA_STEP1_LEGAL_TEXT_KEY: key fija del texto legal de consentimiento
// mostrado en Paso 1, acordada con el agente de legal-text-service /
// consent-service (ver seed de legal_texts, key "pipa_step1").
const PIPA_STEP1_LEGAL_TEXT_KEY = "pipa_step1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CandidateStep1Client = SupabaseClient<any, "public", any>;

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

// Envuelve los errores de validateStep1() en un tipo propio (en vez de
// lanzar el array de Step1ValidationError directamente) para que el
// caller HTTP pueda hacer `err instanceof Step1SubmissionError` de forma
// inequívoca y acceder a `.validationErrors` para construir la respuesta
// 422 con el detalle campo por campo.
export class Step1SubmissionError extends Error {
  readonly validationErrors: Step1ValidationError[];

  constructor(validationErrors: Step1ValidationError[]) {
    const fields = validationErrors.map((e) => e.field).join(", ");
    super(`Step 1 submission failed validation: ${fields}`);
    this.name = "Step1SubmissionError";
    this.validationErrors = validationErrors;
  }
}

// Regla dura del proyecto (ver consent-service.ts): "nunca guardes un
// candidato sin consentimiento explícito". Este error se lanza ANTES de
// tocar la DB si el caller no marcó consentAccepted === true -- no
// dependemos de que recordConsent() lo rechace después, porque para
// entonces ya habríamos insertado el candidato.
export class ConsentRequiredError extends Error {
  constructor() {
    super("Cannot submit Step 1 application: explicit consent is required (consentAccepted must be true)");
    this.name = "ConsentRequiredError";
  }
}

// Fix de auditoría externa (hallazgo confirmado, Prioridad 3): antes no
// existía ninguna verificación de duplicados -- el mismo candidato podía
// enviar el formulario público repetidas veces (mismo email o teléfono)
// sin límite. Se agregaron índices únicos parciales en `candidates`
// (migración 297_hiring_flow_candidates_dedup_unique_index.sql) que
// bloquean, a nivel de Postgres (atómico, sin ventana TOCTOU), más de una
// aplicación activa (status <> 'rejected') por email o teléfono
// normalizado. Este error envuelve la violación de esa constraint
// (Postgres error.code "23505") para que el caller HTTP pueda distinguirlo
// inequívocamente y devolver 409 en vez de 500.
export class DuplicateApplicationError extends Error {
  constructor() {
    super(
      "An active application already exists for this email or phone number. " +
        "Please wait until it is resolved, or contact us if you need to update it."
    );
    this.name = "DuplicateApplicationError";
  }
}

// Fix (auditoría externa 2026-08-02, hallazgo CRÍTICO #2): el candidato
// ahora obtiene el texto legal real vía GET /api/hiring-flow/legal-text
// (ver esa ruta) y el frontend envía de vuelta la versión exacta que se le
// mostró (`legalTextVersion`). Si para cuando llega el submit la versión
// activa cambió (ej. legal actualizó/activó una nueva versión entre que el
// candidato cargó el formulario y lo envió), el texto que efectivamente
// aceptó ya no es el texto legal vigente -- registrar el consentimiento
// contra la versión nueva sería mentir sobre qué aceptó el candidato. En
// vez de eso se rechaza explícitamente para que el frontend recargue el
// texto legal y el candidato vuelva a aceptar el vigente.
export class LegalTextVersionMismatchError extends Error {
  readonly expectedVersion: string;
  readonly currentVersion: string;

  constructor(expectedVersion: string, currentVersion: string) {
    super(
      `Legal text version mismatch: candidate consented to version "${expectedVersion}", ` +
        `but the currently active version is "${currentVersion}". The legal text was updated ` +
        `since this form was loaded.`
    );
    this.name = "LegalTextVersionMismatchError";
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

// ---------------------------------------------------------------------------
// Nota de atomicidad candidato + consentimiento (actualizada)
// ---------------------------------------------------------------------------
//
// El plan exige: "nunca guardes un candidato sin consentimiento explícito
// registrado". La primera versión de este archivo resolvía esto con un
// saga con compensación (insertar candidato -> intentar registrar
// consentimiento -> si fallaba, borrar el candidato) porque en ese momento
// no existía todavía una función RPC para hacerlo atómico. Eso dejaba una
// ventana real: si la compensación (el borrado) también fallaba, podía
// quedar un candidato huérfano sin consentimiento -- justo lo que la regla
// prohíbe.
//
// Fix: supabase/migrations/268_hiring_flow_submit_step1_atomic.sql agrega
// `submit_step1_candidate(...)`, una función RPC SECURITY DEFINER (mismo
// patrón que `set_current_fixed_costs`, migración 249, y
// `set_system_setting`, migración 252) que inserta candidates + consents
// dentro de una única transacción de Postgres real. Si cualquiera de los
// dos falla, Postgres revierte ambos -- nunca puede quedar un candidato
// sin consentimiento, y ya no hace falta ninguna lógica de compensación en
// esta capa. La clase OrphanedCandidateError que existía en la versión
// anterior de este archivo ya no es necesaria y se eliminó junto con ella.
//
// El renderizado del texto legal (leer `company_name` de system_settings y
// reemplazar placeholders -- legal-text-service.ts: renderLegalText/
// renderTemplate) sigue ocurriendo en TypeScript, ANTES de llamar a la
// RPC: es lógica de aplicación, no algo que tenga sentido reimplementar en
// PL/pgSQL. Como renderLegalText() no escribe nada en la DB, que ocurra
// fuera de la transacción no rompe la atomicidad -- si falla (texto no
// encontrado o placeholder sin resolver), la RPC ni siquiera se invoca y
// no se crea ningún candidato.

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

function resolveClient(client?: CandidateStep1Client): CandidateStep1Client {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a candidates"
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Pasos internos, expuestos como funciones inyectables
// ---------------------------------------------------------------------------
//
// Mismo patrón de inyección de dependencia explícita usado en
// consent-service.ts (`renderLegalTextFn`): cada dependencia externa de
// submitStep1Application (posiciones, validación, renderizado legal,
// código de acceso, y los pasos internos de insert atómico/audit) es un
// parámetro opcional cuyo default es la implementación real importada.
// Esto permite testear submitStep1Application con mocks simples inyectados
// directamente, sin depender de que los módulos de los otros agentes ya
// existan compilados con su implementación final -- los tests solo
// necesitan que el archivo exista con la firma correcta para poder
// importar los tipos, y pueden stubear el comportamiento vía inyección en
// vez de mockear el módulo.

export type GetPublicPositionFn = typeof getPublicPosition;
export type ValidateStep1Fn = typeof validateStep1;
export type RenderLegalTextFn = typeof renderLegalText;
export type IssueAccessCodeFn = typeof issueAccessCode;

export interface CandidateWithConsentResult {
  candidateId: string;
  consentId: string;
}

// Reemplaza a InsertCandidateFn + RecordConsentFn + DeleteCandidateFn de
// la versión anterior (saga con compensación). Ahora es una sola
// operación atómica -- ver "Nota de atomicidad" arriba y
// supabase/migrations/268_hiring_flow_submit_step1_atomic.sql.
export type InsertCandidateWithConsentFn = (
  params: {
    positionSlug: string;
    input: Step1Input;
    legalTextKey: string;
    legalTextVersion: string;
    legalTextId: string;
    ipAddress: string;
    userAgent: string | null;
  },
  client: CandidateStep1Client
) => Promise<CandidateWithConsentResult>;

export type InsertFunnelEventFn = (
  params: { candidateId: string; eventType: string; toStatus: string },
  client: CandidateStep1Client
) => Promise<void>;

// NOTA sobre position_id: getPublicPosition() (Fase 4.1) deliberadamente
// NO expone `id` en PublicPosition (regla de no filtrar UUIDs internos en
// respuestas públicas). Pero `candidates.position_id` SÍ necesita el UUID
// real para el FK. Por eso el insert del candidato NO puede depender
// únicamente de PublicPosition -- resolvemos el id internamente con una
// query propia (server-side, nunca expuesta al candidato) usando el mismo
// slug ya validado como público por getPublicPosition() en el paso previo.
async function resolvePositionId(
  slug: string,
  client: CandidateStep1Client
): Promise<string> {
  const { data, error } = await client
    .from("positions")
    .select("id")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();

  if (error || !data) {
    // No debería pasar: ya confirmamos con getPublicPosition() que existe
    // y es pública, milisegundos antes. Un TOCTOU aquí (la posición se
    // despublicó justo en el medio) es la única causa razonable.
    throw new PositionNotFoundError(slug);
  }
  return (data as { id: string }).id;
}

// Implementación real de InsertCandidateWithConsentFn: resuelve el
// position_id interno (ver resolvePositionId arriba) y llama a la RPC
// atómica submit_step1_candidate (268) -- un solo round-trip, una sola
// transacción de Postgres, candidates + consents o ninguno de los dos.
async function defaultInsertCandidateWithConsent(
  params: {
    positionSlug: string;
    input: Step1Input;
    legalTextKey: string;
    legalTextVersion: string;
    legalTextId: string;
    ipAddress: string;
    userAgent: string | null;
  },
  client: CandidateStep1Client
): Promise<CandidateWithConsentResult> {
  const positionId = await resolvePositionId(params.positionSlug, client);

  const { data, error } = await client.rpc("submit_step1_candidate", {
    p_position_id: positionId,
    p_first_name: params.input.firstName,
    p_last_name: params.input.lastName,
    p_email: params.input.email,
    p_phone: params.input.phone,
    p_date_of_birth: params.input.dateOfBirth,
    p_legal_text_key: params.legalTextKey,
    p_legal_text_version: params.legalTextVersion,
    p_legal_text_id: params.legalTextId,
    p_consent_accepted: true,
    p_ip_address: params.ipAddress,
    p_user_agent: params.userAgent,
  });

  // submit_step1_candidate es RETURNS TABLE -> data llega como array de
  // filas (una sola fila en este caso). Si la RPC lanzó una excepción de
  // Postgres (ej. el guard de consentimiento dentro de la función), llega
  // acá como `error`, no como excepción de JS -- se relanza como Error
  // normal para que el resto del flujo (y los tests) lo traten igual que
  // cualquier otro fallo de inserción.
  if (error) {
    // Violación del índice único parcial de email/teléfono (297) -- ver
    // DuplicateApplicationError arriba. Postgres reporta esto con el
    // código estándar de unique_violation, "23505"; mismo criterio de
    // detección ya usado en otras rutas del repo (ver sick-leave/route.ts,
    // partner-commissions/route.ts, equipment-reservations/route.ts).
    if ((error as { code?: string }).code === "23505") {
      throw new DuplicateApplicationError();
    }
    throw new Error(`submit_step1_candidate RPC failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.candidate_id || !row.consent_id) {
    throw new Error(
      "submit_step1_candidate RPC returned no data (expected candidate_id + consent_id)"
    );
  }

  return { candidateId: row.candidate_id as string, consentId: row.consent_id as string };
}

// Best-effort a propósito (ver punto (g) de la tarea): funnel_events es
// solo telemetría/auditoría interna, no un requisito legal como consents.
// Si este insert falla, NO debe tumbar la respuesta al candidato -- el
// candidato ya tiene su candidateId, su consentimiento registrado, y su
// código de acceso emitido; perder un evento de auditoría es indeseable
// pero no bloqueante. Se loguea a console.error para no perder la señal
// por completo.
//
// Revisión de auditoría externa (falso positivo confirmado): un reporte
// externo señaló que este insert ocurre fuera de la RPC atómica (268) y
// que una falla se "pierde en silencio". Lo primero es cierto a propósito
// (ver nota de atomicidad arriba: meter telemetría dentro de la misma
// transacción que candidates+consents mezclaría una preocupación legal
// bloqueante con una de auditoría best-effort, y forzaría revertir un
// candidato+consentimiento válidos solo porque falló un insert de
// telemetría). Lo segundo NO es cierto: el try/catch de abajo ya loguea
// explícitamente cualquier fallo (tanto el `error` de PostgREST como una
// excepción inesperada) con el candidateId, así que el fallo es visible
// en los logs del servidor, no silencioso. No se requiere ningún cambio
// de código para este hallazgo -- se documenta acá para dejar constancia
// de que fue revisado y no es un bug real.
async function defaultInsertFunnelEvent(
  params: { candidateId: string; eventType: string; toStatus: string },
  client: CandidateStep1Client
): Promise<void> {
  try {
    const { error } = await client.from("funnel_events").insert({
      candidate_id: params.candidateId,
      event_type: params.eventType,
      from_status: null,
      to_status: params.toStatus,
    });
    if (error) {
      console.error(
        `[candidate-step1-service] Failed to insert funnel_event (best-effort, not fatal) for candidate "${params.candidateId}": ${error.message}`
      );
    }
  } catch (err) {
    console.error(
      `[candidate-step1-service] Unexpected error inserting funnel_event (best-effort, not fatal) for candidate "${params.candidateId}":`,
      err
    );
  }
}

// ---------------------------------------------------------------------------
// submitStep1Application
// ---------------------------------------------------------------------------

export interface SubmitStep1ApplicationParams {
  positionSlug: string;
  input: Step1Input;
  ipAddress: string;
  userAgent: string | null;
  consentAccepted: boolean;
  // Versión del texto legal ("pipa_step1") que el candidato efectivamente
  // vio y aceptó en el frontend (obtenida de GET
  // /api/hiring-flow/legal-text). Opcional para no romper callers/tests
  // existentes que no la pasan, pero si viene, se valida contra la
  // versión activa real -- ver LegalTextVersionMismatchError arriba.
  expectedLegalTextVersion?: string;
  client?: CandidateStep1Client;

  // Dependencias inyectables (default = implementación real importada).
  // Ver nota de patrón de inyección arriba.
  getPublicPositionFn?: GetPublicPositionFn;
  validateStep1Fn?: ValidateStep1Fn;
  renderLegalTextFn?: RenderLegalTextFn;
  issueAccessCodeFn?: IssueAccessCodeFn;
  insertCandidateWithConsentFn?: InsertCandidateWithConsentFn;
  insertFunnelEventFn?: InsertFunnelEventFn;
}

export interface SubmitStep1ApplicationResult {
  candidateId: string;
  accessCode: string;
  accessCodeExpiresAt: Date;
}

export async function submitStep1Application(
  params: SubmitStep1ApplicationParams
): Promise<SubmitStep1ApplicationResult> {
  const getPublicPositionImpl = params.getPublicPositionFn ?? getPublicPosition;
  const validateStep1Impl = params.validateStep1Fn ?? validateStep1;
  const renderLegalTextImpl = params.renderLegalTextFn ?? renderLegalText;
  const issueAccessCodeImpl = params.issueAccessCodeFn ?? issueAccessCode;
  const insertCandidateWithConsentImpl =
    params.insertCandidateWithConsentFn ?? defaultInsertCandidateWithConsent;
  const insertFunnelEventImpl = params.insertFunnelEventFn ?? defaultInsertFunnelEvent;

  const resolved = resolveClient(params.client);

  // (a) Resolver la posición. Si no existe (o no es pública -- mismo
  // comportamiento, ver positions-service.ts), PositionNotFoundError se
  // propaga tal cual, sin tocar nada más.
  await getPublicPositionImpl(params.positionSlug, resolved);

  // (b) Validar el input. Si hay errores, Step1SubmissionError -- nunca
  // llegamos a la DB.
  const validationErrors = validateStep1Impl(params.input);
  if (validationErrors.length > 0) {
    throw new Step1SubmissionError(validationErrors);
  }

  // (c) Consentimiento explícito obligatorio, chequeado ANTES de insertar
  // nada -- nunca se guarda un candidato "a la espera" de que confirme
  // consentimiento después.
  if (params.consentAccepted !== true) {
    throw new ConsentRequiredError();
  }

  // (d) Renderizar el texto legal de consentimiento ANTES de tocar la DB.
  // No escribe nada (solo lee legal_texts + system_settings), así que si
  // falla (LegalTextNotFoundError / UnrenderedPlaceholderError) se
  // propaga tal cual y no se crea ningún candidato -- nunca se llega a
  // enviarle al candidato un texto a medio renderizar.
  const { version: legalTextVersion, textId: legalTextId } = await renderLegalTextImpl(
    PIPA_STEP1_LEGAL_TEXT_KEY,
    undefined,
    resolved
  );

  // (d.1) Si el frontend indicó qué versión le mostró al candidato, debe
  // coincidir con la versión activa real resuelta arriba -- ver
  // LegalTextVersionMismatchError. Chequeado ANTES de insertar nada, mismo
  // criterio que (c).
  if (
    params.expectedLegalTextVersion !== undefined &&
    params.expectedLegalTextVersion !== legalTextVersion
  ) {
    throw new LegalTextVersionMismatchError(params.expectedLegalTextVersion, legalTextVersion);
  }

  // (e) Insertar candidato + consentimiento en una sola operación atómica
  // (RPC submit_step1_candidate, 268 -- ver "Nota de atomicidad" arriba).
  // Ya no hace falta saga ni compensación: si esto falla, Postgres
  // revierte todo dentro de su propia transacción y no queda ningún
  // rastro parcial.
  const { candidateId } = await insertCandidateWithConsentImpl(
    {
      positionSlug: params.positionSlug,
      input: params.input,
      legalTextKey: PIPA_STEP1_LEGAL_TEXT_KEY,
      legalTextVersion,
      legalTextId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    },
    resolved
  );

  // (f) Emitir el código de acceso al Paso 2.
  const purpose: AccessCodePurpose = "step2";
  const { rawCode, expiresAt } = await issueAccessCodeImpl(candidateId, purpose, resolved);

  // (g) Auditoría best-effort -- ver defaultInsertFunnelEvent: nunca debe
  // tumbar la respuesta al candidato, a diferencia de (e) que sí es
  // bloqueante (requisito legal vs. telemetría).
  await insertFunnelEventImpl(
    { candidateId, eventType: "step1_submitted", toStatus: "step1_completed" },
    resolved
  );

  // (h) El envío real del código por SMS/email queda fuera de este
  // módulo (cola de mensajes / communications / cron, Fase 4.4 según el
  // plan) -- este servicio solo devuelve el código en crudo para que el
  // caller HTTP decida cómo notificarlo sin bloquear la respuesta.
  return {
    candidateId,
    accessCode: rawCode,
    accessCodeExpiresAt: expiresAt,
  };
}
