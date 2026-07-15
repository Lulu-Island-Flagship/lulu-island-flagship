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
