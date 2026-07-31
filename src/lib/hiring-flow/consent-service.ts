import type { SupabaseClient } from "@supabase/supabase-js";
import { renderLegalText } from "./legal-text-service";
import { getHiringFlowServiceClient } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). No tiene integración con el resto del sistema todavía.
//
// Tabla asumida (ver migraciones de Fase 2, creadas en paralelo por otro
// agente; contrato acordado, NO se crea aquí ni se stubea):
//   consents(
//     id UUID,
//     candidate_id UUID,
//     legal_text_key TEXT,
//     legal_text_version TEXT,
//     legal_text_id UUID,
//     accepted BOOLEAN,
//     ip_address TEXT,
//     user_agent TEXT,
//     created_at TIMESTAMPTZ
//   )
//
// Regla dura del proyecto: "guarda qué texto se mostró, qué versión era,
// fecha/hora, IP, user agent, nunca solo aceptó:true". Por eso
// legalTextVersion/legalTextId de ConsentRecord SIEMPRE vienen de la
// respuesta de renderLegalText() -- nunca inventados ni copiados de otro
// lado -- y buildConsentRecord() nunca produce un record si el texto no se
// pudo renderizar completo (el error de renderLegalText se propaga tal
// cual, sin atrapar).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConsentsClient = SupabaseClient<any, "public", any>;

export interface ConsentRecord {
  candidateId: string;
  legalTextKey: string;
  legalTextVersion: string;
  legalTextId: string;
  accepted: boolean;
  ipAddress: string;
  userAgent: string | null;
}

// Firma de renderLegalText, extraída como tipo para poder inyectarla como
// dependencia opcional en buildConsentRecord. Se hace así (en vez de
// mockear el módulo import directamente) porque en este repo/entorno de
// test mockear un import ESM de otro archivo del mismo módulo es más
// frágil que la inyección de dependencia explícita; con un parámetro
// opcional `renderLegalTextFn` cuyo default es la función real importada,
// los tests pueden pasar un stub sin tocar el sistema de módulos, y el
// código de producción no cambia (sigue usando la implementación real por
// default).
type RenderLegalTextFn = typeof renderLegalText;

export interface BuildConsentRecordParams {
  candidateId: string;
  legalTextKey: string;
  accepted: boolean;
  ipAddress: string;
  userAgent: string | null;
  variables?: Record<string, string>;
  client?: ConsentsClient;
  renderLegalTextFn?: RenderLegalTextFn;
}

export async function buildConsentRecord(
  params: BuildConsentRecordParams
): Promise<{ record: ConsentRecord; renderedText: string }> {
  const render = params.renderLegalTextFn ?? renderLegalText;

  // Si render() lanza (LegalTextNotFoundError, UnrenderedPlaceholderError,
  // o cualquier otro error), se propaga tal cual. Nunca se construye un
  // ConsentRecord sobre un texto que no se pudo renderizar completo.
  const { text, version, textId } = await render(
    params.legalTextKey,
    params.variables,
    params.client
  );

  const record: ConsentRecord = {
    candidateId: params.candidateId,
    legalTextKey: params.legalTextKey,
    legalTextVersion: version,
    legalTextId: textId,
    accepted: params.accepted,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  };

  return { record, renderedText: text };
}

function resolveConsentsClient(client?: ConsentsClient): ConsentsClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede insertar en consents"
    );
  }
  return resolved;
}

export async function insertConsent(
  record: ConsentRecord,
  client?: ConsentsClient
): Promise<{ consentId: string }> {
  const resolved = resolveConsentsClient(client);

  const { data, error } = await resolved
    .from("consents")
    .insert({
      candidate_id: record.candidateId,
      legal_text_key: record.legalTextKey,
      legal_text_version: record.legalTextVersion,
      legal_text_id: record.legalTextId,
      accepted: record.accepted,
      ip_address: record.ipAddress,
      user_agent: record.userAgent,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert consent for candidate "${record.candidateId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  return { consentId: (data as { id: string }).id };
}

export type RecordConsentParams = BuildConsentRecordParams;

export async function recordConsent(
  params: RecordConsentParams
): Promise<{ consentId: string; renderedText: string }> {
  // build primero: si el texto legal no renderiza completo, esto lanza y
  // nunca llegamos a insertConsent (no debe haber insert en ese caso).
  const { record, renderedText } = await buildConsentRecord(params);
  const { consentId } = await insertConsent(record, params.client);
  return { consentId, renderedText };
}
