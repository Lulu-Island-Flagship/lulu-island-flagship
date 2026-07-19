/**
 * v8.3 E0.8 — Adaptador de firma digital (Documenso/DocuSign).
 *
 * Re-exporta `src/lib/esignature-provider.ts` (nuevo — no existía ningún
 * adaptador de firma digital antes de este pase, ni siquiera un stub) bajo
 * el punto de importación estable del adaptador.
 */

export {
  requestSignature,
  type EsignatureDocumentType,
  type RequestSignatureInput,
  type RequestSignatureResult,
} from "@/lib/esignature-provider";

import {
  requestSignature,
  type RequestSignatureInput,
  type RequestSignatureResult,
} from "@/lib/esignature-provider";

/**
 * v8.3 E0 (auditoría 2026-07-18) — interfaz abstracta mínima + mock, para que
 * código de negocio pueda depender de `EsignatureAdapter` en vez de la
 * función concreta, y los tests puedan inyectar `createMockEsignatureAdapter()`
 * en vez de golpear el proveedor real (que hoy ni siquiera está configurado).
 */
export interface EsignatureAdapter {
  requestSignature(input: RequestSignatureInput): Promise<RequestSignatureResult>;
}

export const esignatureAdapter: EsignatureAdapter = { requestSignature };

export function createMockEsignatureAdapter(
  overrides?: Partial<EsignatureAdapter>
): EsignatureAdapter {
  return {
    requestSignature: async (_input: RequestSignatureInput) => ({
      status: "not_configured",
      providerEnvelopeId: null,
      providerResponse: null,
    }),
    ...overrides,
  };
}
