/**
 * v8.3 C.1/D.9 — Interfaz de firma digital (Documenso o DocuSign,
 * PIPEDA-compliant) para los 3 contratos digitales (T&C cliente, recurrente,
 * laboral).
 *
 * TODO(dueño/infra): no hay proveedor de firma digital contratado todavía.
 * Antes de usar esto en producción, integrar Documenso (gratis) o DocuSign y
 * setear las credenciales como variables de entorno (nunca hardcodeadas).
 * Los 3 contratos de D.9 siguen siendo borradores hasta que además pasen
 * revisión de abogado de BC (condición separada, B.4) -- este adaptador solo
 * cubre el mecanismo de firma, no la validez legal del contenido.
 *
 * Mismo patrón que sms.ts / weather-provider.ts / qbo-adapter.ts: mientras
 * no haya proveedor configurado, requestSignature() nunca intenta una
 * llamada de red — devuelve status "not_configured" de forma determinista.
 */

export type EsignatureDocumentType = "client_terms" | "recurring_contract" | "employment_contract";

export interface RequestSignatureInput {
  documentType: EsignatureDocumentType;
  signerName: string;
  signerEmail: string;
  documentContent: string;
}

export interface RequestSignatureResult {
  status: "not_configured" | "sent" | "failed";
  providerEnvelopeId: string | null;
  providerResponse: string | null;
}

/**
 * Interfaz estable de solicitud de firma. Implementación real pendiente (ver
 * TODO arriba). Nunca lanza: siempre resuelve con un resultado explícito
 * para que el caller registre el intento sin fallar silenciosamente ni
 * inventar una integración que no existe.
 */
export async function requestSignature(_input: RequestSignatureInput): Promise<RequestSignatureResult> {
  // TODO(dueño/infra): reemplazar este bloque por la llamada real a
  // Documenso/DocuSign una vez exista contrato + credenciales. Ejemplo de
  // forma esperada (NO implementado, NO son credenciales reales):
  //
  //   const client = getEsignatureProviderClient();
  //   const envelope = await client.envelopes.create({ signerEmail: input.signerEmail, document: input.documentContent });
  //   return { status: "sent", providerEnvelopeId: envelope.id, providerResponse: envelope.status };

  return {
    status: "not_configured",
    providerEnvelopeId: null,
    providerResponse: null,
  };
}
