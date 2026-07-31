import type { SupabaseClient } from "@supabase/supabase-js";
import { renderLegalText } from "../hiring-flow/legal-text-service";
import { getHiringFlowServiceClient } from "../hiring-flow/settings-service";
import type { ClientConsentType } from "./types";

// Módulo nuevo y separado: "Módulo de Cliente". Análogo a
// hiring-flow/consent-service.ts, pero para clientes en vez de candidatos.
//
// renderLegalText (importada tal cual de ../hiring-flow/legal-text-service)
// ya es genérica: lee la tabla legal_texts, que sirve para cualquier texto
// legal del sistema, no solo textos de empleados/candidatos.
//
// Tabla asumida (otro agente la está creando en paralelo, contrato
// acordado, NO se crea ni se stubea aquí):
//   client_consents(id UUID, client_id UUID, consent_type TEXT,
//     legal_text_key TEXT, legal_text_version TEXT, legal_text_id UUID,
//     accepted BOOLEAN, ip_address TEXT, user_agent TEXT, created_at)
//
// Regla dura (misma que hiring-flow/consent-service.ts): legalTextVersion/
// legalTextId SIEMPRE vienen de la respuesta de renderLegalText(), nunca
// inventados ni copiados de otro lado. Si el render falla (texto no
// encontrado o placeholder sin resolver), el error se propaga tal cual y
// NUNCA se inserta un consentimiento sobre un texto a medio renderizar.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClientConsentsClient = SupabaseClient<any, "public", any>;

// Firma de renderLegalText extraída como tipo para poder inyectarla como
// dependencia opcional (mismo patrón de inyección de dependencia explícita
// que usó el módulo hermano hiring-flow/consent-service.ts para poder
// testear sin mockear el sistema de módulos ESM).
type RenderLegalTextFn = typeof renderLegalText;

export interface RecordClientConsentParams {
  clientId: string;
  consentType: ClientConsentType;
  legalTextKey: string;
  accepted: boolean;
  ipAddress: string;
  userAgent: string | null;
  variables?: Record<string, string>;
  client?: ClientConsentsClient;
  renderLegalTextFn?: RenderLegalTextFn;
}

function resolveClient(client?: ClientConsentsClient): ClientConsentsClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede insertar en client_consents"
    );
  }
  return resolved;
}

export async function recordClientConsent(
  params: RecordClientConsentParams
): Promise<{ consentId: string; renderedText: string }> {
  const render = params.renderLegalTextFn ?? renderLegalText;

  // Si render() lanza (LegalTextNotFoundError, UnrenderedPlaceholderError,
  // o cualquier otro error), se propaga tal cual. Nunca se llega al insert
  // en ese caso.
  const { text, version, textId } = await render(
    params.legalTextKey,
    params.variables,
    params.client
  );

  const resolved = resolveClient(params.client);

  const { data, error } = await resolved
    .from("client_consents")
    .insert({
      client_id: params.clientId,
      consent_type: params.consentType,
      legal_text_key: params.legalTextKey,
      legal_text_version: version,
      legal_text_id: textId,
      accepted: params.accepted,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert client_consent for client "${params.clientId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  return { consentId: (data as { id: string }).id, renderedText: text };
}
