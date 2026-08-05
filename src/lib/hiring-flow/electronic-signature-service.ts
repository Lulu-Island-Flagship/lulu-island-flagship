import { createHash } from "@/lib/crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 5.3 "Firma Electrónica".
//
// Tabla YA EXISTENTE (creada en la migración 262_hiring_flow_electronic_
// signatures.sql, no se toca aquí):
//   electronic_signatures(
//     id UUID,
//     candidate_id UUID,
//     document_reference TEXT,
//     document_hash TEXT,
//     signed_at TIMESTAMPTZ,
//     ip_address TEXT,
//     user_agent TEXT
//   )
//
// Regla dura y explícita del plan v0.4.1: "la firma electrónica no es un
// campo booleano, es un registro inmutable". Por eso este servicio SOLO
// hace INSERT (recordElectronicSignature) y SELECT (implícito en
// verifySignatureIntegrity) contra electronic_signatures -- nunca UPDATE
// ni DELETE. La tabla 262 fue creada deliberadamente SIN policy de UPDATE/
// DELETE (ni siquiera USING(false) explícito, ver comentario de cabecera
// de esa migración) precisamente para que ni siquiera exista como
// operación concebible sobre esta tabla. No agregar nunca un
// updateElectronicSignature() ni deleteElectronicSignature() a este
// archivo.
//
// hashDocumentContent() vs. hashCode() de access-code-service.ts: ambas
// usan SHA-256 vía node:crypto con el mismo criterio (alta entropía de
// entrada, no hace falta un KDF lento tipo bcrypt/argon2). Se REIMPLEMENTA
// aquí en vez de importar hashCode() porque conceptualmente son cosas
// distintas -- hashCode() hashea un código de acceso corto (8 caracteres,
// siempre string) para compararlo contra un valor guardado, mientras que
// hashDocumentContent() hashea el contenido completo de un documento
// (potencialmente grande, string O binario/Uint8Array) para poder probar
// más adelante que ese documento específico no fue alterado después de
// firmarse. Acoplar ambos casos de uso a la misma función solo porque hoy
// comparten el algoritmo (SHA-256) haría que un cambio de necesidad en uno
// (ej. hashCode necesitando cambiar de algoritmo por rendimiento de
// códigos cortos) arriesgue romper al otro sin relación real entre ambos.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SignaturesClient = SupabaseClient<any, "public", any>;

// ---------------------------------------------------------------------------
// hashDocumentContent -- pura, testeable sin DB
// ---------------------------------------------------------------------------

export function hashDocumentContent(content: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof content === "string") {
    hash.update(content, "utf8");
  } else {
    hash.update(content);
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Supabase client resolution -- mismo patrón que el resto del módulo
// ---------------------------------------------------------------------------

function resolveClient(client?: SignaturesClient): SignaturesClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a electronic_signatures"
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// recordElectronicSignature
// ---------------------------------------------------------------------------

export interface RecordSignatureParams {
  candidateId: string;
  documentReference: string;
  documentContent: string | Uint8Array;
  ipAddress: string;
  userAgent: string | null;
}

interface ElectronicSignatureInsertResult {
  id: string;
  document_hash: string;
}

// INSERT únicamente -- la tabla no soporta UPDATE/DELETE (ver comentario
// de cabecera). Calcula el hash del contenido EXACTO que se está firmando
// en este momento (documentContent), nunca un hash pasado en crudo por el
// caller sin recalcular, para garantizar que document_hash siempre
// corresponde a lo que realmente se firmó.
export async function recordElectronicSignature(
  params: RecordSignatureParams,
  client?: SignaturesClient
): Promise<{ signatureId: string; documentHash: string }> {
  const resolved = resolveClient(client);
  const documentHash = hashDocumentContent(params.documentContent);

  const { data, error } = await resolved
    .from("electronic_signatures")
    .insert({
      candidate_id: params.candidateId,
      document_reference: params.documentReference,
      document_hash: documentHash,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
    })
    .select("id, document_hash")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to record electronic signature for candidate "${params.candidateId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  const row = data as ElectronicSignatureInsertResult;
  return { signatureId: row.id, documentHash: row.document_hash };
}

// ---------------------------------------------------------------------------
// verifySignatureIntegrity
// ---------------------------------------------------------------------------

// Recalcula el hash del contenido ACTUAL de un documento y lo compara
// contra el document_hash guardado en el momento de la firma. Permite
// detectar si el documento fue alterado después de firmarse -- exactamente
// la evidencia que justifica que document_hash exista en la tabla 262 (ver
// su comentario de cabecera: "para poder demostrar que el documento no
// cambió después de la firma"). SELECT únicamente, nunca UPDATE.
export async function verifySignatureIntegrity(
  signatureId: string,
  currentDocumentContent: string | Uint8Array,
  client?: SignaturesClient
): Promise<boolean> {
  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("electronic_signatures")
    .select("document_hash")
    .eq("id", signatureId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch electronic signature "${signatureId}": ${error.message}`);
  }

  if (!data) {
    throw new Error(`Electronic signature not found: "${signatureId}"`);
  }

  const storedHash = (data as { document_hash: string }).document_hash;
  const currentHash = hashDocumentContent(currentDocumentContent);
  return storedHash === currentHash;
}
