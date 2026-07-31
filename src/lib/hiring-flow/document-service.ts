import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient, getSetting } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 5.1: "Paso 2: Disponibilidad y Documentos".
//
// Tabla usada (ver supabase/migrations/261_hiring_flow_documents.sql,
// Fase 2, ya aplicada -- NO se crea ni se edita aquí):
//   documents(
//     id UUID,
//     candidate_id UUID,
//     document_type TEXT,
//     storage_path TEXT,
//     mime_type TEXT,
//     size_bytes INTEGER CHECK (size_bytes > 0),
//     uploaded_at TIMESTAMPTZ
//   )
//
// Alcance de este archivo: SOLO valida un archivo candidato a subirse
// (tipo de documento, mime real por magic numbers, tamaño) y persiste el
// registro/metadata en `documents` una vez que el archivo YA fue subido a
// donde sea que este repo suba binarios. La subida real del archivo a
// storage está fuera de alcance -- no hay un patrón existente de Supabase
// Storage claramente establecido en este repo al momento de escribir este
// archivo (búsqueda rápida no encontró un wrapper genérico de Storage
// reutilizable); ese trabajo queda para el endpoint HTTP / Fase de subida
// real, no para este servicio.
//
// La compresión de imágenes YA EXISTE en src/lib/image-compress.ts
// (compressImageToWebP, computeTargetDimensions, nextQuality,
// shouldRetryCompression). Este archivo NO la duplica -- solo decide SI
// hace falta comprimir (`needsCompression`) y deja que el caller (futuro
// endpoint HTTP, que sí corre en el navegador y tiene acceso a
// Canvas/File) invoque esas funciones ya existentes.

type DocumentsClient = SupabaseClient<any, "public", any>;

// [ASSUMPTION] -- el documento fuente real v0.4.1 con la lista exacta de
// tipos de documento requeridos por este flujo de contratación NO está
// disponible al momento de escribir este archivo. Esta lista es un
// criterio razonable basado en un flujo de contratación típico en BC
// (identificación con foto, SIN para nómina/impuestos, cheque anulado/void
// cheque para depósito directo, y certificaciones relevantes al puesto,
// ej. Food Safe, WHMIS). Verificar contra el documento fuente real antes
// de producción y ajustar esta lista si difiere.
export const ALLOWED_DOCUMENT_TYPES = [
  "id_front",
  "id_back",
  "sin_document",
  "void_cheque",
  "certification",
  "work_permit",
  "proof_of_address",
] as const;

export type DocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export class DocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentValidationError";
  }
}

// ---------------------------------------------------------------------------
// detectMimeTypeFromBytes -- pura, sin DB, sin I/O.
// ---------------------------------------------------------------------------
//
// Regla dura del plan: "valida el tipo MIME del archivo, no solo la
// extensión. Un .jpg renombrado no debe explotar el procesador de
// imágenes". El campo `mimetype`/extensión que reporta el cliente es
// trivialmente falsificable (basta con renombrar el archivo o mentir en el
// header del upload) -- la única fuente confiable es inspeccionar los
// bytes reales del archivo (magic numbers / file signatures).
//
// Firmas implementadas:
//   JPEG: FF D8 FF                                  (primeros 3 bytes)
//   PNG:  89 50 4E 47 0D 0A 1A 0A                    (primeros 8 bytes)
//   WEBP: "RIFF" (bytes 0-3) + "WEBP" (bytes 8-11)   (contenedor RIFF)
//   PDF:  25 50 44 46 ("%PDF", primeros 4 bytes)

function matchesSignature(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

export function detectMimeTypeFromBytes(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length === 0) return null;

  if (matchesSignature(bytes, 0, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }

  if (matchesSignature(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }

  if (matchesSignature(bytes, 0, [0x25, 0x50, 0x44, 0x46])) {
    return "application/pdf";
  }

  // WEBP: contenedor RIFF genérico -- "RIFF" en los primeros 4 bytes, 4
  // bytes de tamaño de chunk (ignorados), luego "WEBP" en los bytes 8-11.
  const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
  const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
  if (matchesSignature(bytes, 0, RIFF) && matchesSignature(bytes, 8, WEBP)) {
    return "image/webp";
  }

  return null;
}

// ---------------------------------------------------------------------------
// validateDocumentUpload
// ---------------------------------------------------------------------------

export interface ValidateDocumentUploadParams {
  documentType: string;
  declaredMimeType: string;
  bytes: Uint8Array;
}

export interface ValidateDocumentUploadResult {
  detectedMimeType: string;
  sizeBytes: number;
  needsCompression: boolean;
}

export async function validateDocumentUpload(
  params: ValidateDocumentUploadParams,
  client?: DocumentsClient
): Promise<ValidateDocumentUploadResult> {
  if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(params.documentType)) {
    throw new DocumentValidationError(
      `Invalid document type "${params.documentType}". Allowed types: ${ALLOWED_DOCUMENT_TYPES.join(", ")}`
    );
  }

  // Nunca confíes en declaredMimeType para decidir -- solo se usa más
  // abajo para loguear una discrepancia sospechosa, nunca para aceptar o
  // rechazar el archivo.
  const detectedMimeType = detectMimeTypeFromBytes(params.bytes);
  if (!detectedMimeType) {
    throw new DocumentValidationError(
      "Could not detect a known file type from the file's bytes (no matching magic number). The file may be corrupted or of an unsupported type."
    );
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(detectedMimeType)) {
    throw new DocumentValidationError(
      `Detected file type "${detectedMimeType}" is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`
    );
  }

  if (params.declaredMimeType !== detectedMimeType) {
    // No es fatal por sí solo (ej. un navegador que reporta
    // "application/octet-stream" genérico no es necesariamente malicioso),
    // pero es una señal sospechosa que vale la pena loguear -- un .jpg
    // renombrado a .pdf, por ejemplo, caería acá.
    console.warn(
      `[document-service] Declared MIME type "${params.declaredMimeType}" does not match detected MIME type "${detectedMimeType}" for documentType "${params.documentType}". Proceeding with the detected type.`
    );
  }

  const sizeBytes = params.bytes.length;
  const sizeMb = sizeBytes / (1024 * 1024);

  const maxFileSizeMb = Number(await getSetting("security_max_file_size_mb", client));
  if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) {
    throw new Error(
      `Invalid setting "security_max_file_size_mb": expected a positive number, got "${maxFileSizeMb}"`
    );
  }
  if (sizeMb > maxFileSizeMb) {
    throw new DocumentValidationError(
      `File size ${sizeMb.toFixed(2)}MB exceeds the maximum allowed size of ${maxFileSizeMb}MB`
    );
  }

  // needsCompression: solo aplica a imágenes. Un PDF nunca se marca para
  // compresión acá, sin importar su tamaño -- la compresión a WebP
  // (image-compress.ts) es específicamente un pipeline de imágenes vía
  // Canvas, no aplicable a PDFs. Un PDF que excede el límite ya fue
  // rechazado arriba por el chequeo de tamaño máximo.
  let needsCompression = false;
  if (detectedMimeType.startsWith("image/")) {
    const compressionTargetMb = Number(
      await getSetting("security_image_compression_target_mb", client)
    );
    if (!Number.isFinite(compressionTargetMb) || compressionTargetMb <= 0) {
      throw new Error(
        `Invalid setting "security_image_compression_target_mb": expected a positive number, got "${compressionTargetMb}"`
      );
    }
    needsCompression = sizeMb > compressionTargetMb;
  }

  return { detectedMimeType, sizeBytes, needsCompression };
}

// ---------------------------------------------------------------------------
// insertDocumentRecord
// ---------------------------------------------------------------------------

function resolveClient(client?: DocumentsClient): DocumentsClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a documents"
    );
  }
  return resolved;
}

export interface InsertDocumentRecordParams {
  candidateId: string;
  documentType: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

// Persiste solo la metadata -- asume que el archivo YA fue subido a
// `storagePath` por el caller. No valida de nuevo el archivo (eso es
// responsabilidad de validateDocumentUpload, que se espera haya corrido
// antes de la subida real).
export async function insertDocumentRecord(
  params: InsertDocumentRecordParams,
  client?: DocumentsClient
): Promise<{ documentId: string }> {
  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("documents")
    .insert({
      candidate_id: params.candidateId,
      document_type: params.documentType,
      storage_path: params.storagePath,
      mime_type: params.mimeType,
      size_bytes: params.sizeBytes,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert document record for candidate "${params.candidateId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  return { documentId: (data as { id: string }).id };
}
