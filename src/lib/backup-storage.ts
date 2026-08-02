import { createCipheriv, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDeterministicCsv, computeSha256Hex, type BackupJobType } from "@/lib/backup-jobs";

const BACKUP_BUCKET = "backups";

// Fix auditoría de seguridad externa (2026-08-02): los CSV de backup
// (transacciones, nómina, clientes, manifiesto de fotos) contienen PII y
// datos financieros reales y se subían en texto plano al bucket "backups"
// de Supabase Storage -- un bucket privado (RLS de storage), pero sin
// cifrado a nivel de archivo. Defensa en profundidad: si algún día el
// bucket queda mal configurado, se filtra una credencial de service_role,
// o se restaura desde un backup del propio proveedor de storage a un
// entorno equivocado, el contenido del CSV debe seguir siendo ilegible sin
// la clave. Mismo criterio de "nunca simular una protección que no existe"
// que el resto de este módulo (ver honestidad de alcance en
// backup-jobs.ts): si falta la clave, storeBackupCsv debe fallar fuerte
// (throw), nunca subir el CSV sin cifrar como fallback silencioso.
//
// AES-256-GCM (autenticado, detecta tampering) con IV aleatorio de 12 bytes
// por archivo -- mismo algoritmo que pgcrypto usa para banking info
// (migraciones 204/284), pero implementado en Node porque este contenido
// nunca pasa por Postgres (es un CSV construido en memoria, no una columna
// de tabla). El hash SHA-256 registrado en backup_job_runs se calcula
// SIEMPRE sobre el CSV en texto plano (antes de cifrar), para que sirva
// como prueba de integridad del contenido real una vez descifrado -- un
// hash del blob cifrado no demostraría nada útil sobre el CSV en sí.
//
// Formato del archivo subido: `<iv:12 bytes><authTag:16 bytes><ciphertext>`
// en binario -- se antepone el IV y el authTag porque ambos son
// necesarios (y no secretos) para descifrar, y así el archivo es
// autocontenido sin depender de una tabla lateral para guardar el IV.
const BACKUP_ENC_ALGORITHM = "aes-256-gcm";
const BACKUP_ENC_IV_LENGTH = 12;

export class BackupEncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "BACKUP_ENCRYPTION_KEY no configurada del lado servidor: no se puede cifrar el CSV de backup antes de subirlo a Storage. Configúrala en las variables de entorno (ver .env.example) -- nunca se sube un backup sin cifrar como fallback."
    );
    this.name = "BackupEncryptionKeyMissingError";
  }
}

function resolveBackupEncryptionKey(): Buffer {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) {
    throw new BackupEncryptionKeyMissingError();
  }
  // Mismo criterio de generación que PAYROLL_ENCRYPTION_KEY/
  // HIRING_FLOW_ENCRYPTION_KEY (`openssl rand -base64 32`), pero a
  // diferencia de esas dos (que pgcrypto usa como passphrase de longitud
  // libre), createCipheriv exige EXACTAMENTE 32 bytes crudos para
  // AES-256-GCM -- se decodifica primero como base64 (formato recomendado
  // en .env.example) y, si no produce 32 bytes exactos, se intenta hex
  // (`openssl rand -hex 32`) antes de fallar.
  let key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    key = Buffer.from(raw, "hex");
  }
  if (key.length !== 32) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY no decodifica a exactamente 32 bytes (se requieren para AES-256-GCM). Generar con \`openssl rand -base64 32\` (recomendado) o \`openssl rand -hex 32\`.`
    );
  }
  return key;
}

/** Cifra un CSV con AES-256-GCM. Devuelve el blob binario autocontenido (iv || authTag || ciphertext) listo para subir a Storage. */
function encryptBackupCsv(csv: string, key: Buffer): Buffer {
  const iv = randomBytes(BACKUP_ENC_IV_LENGTH);
  const cipher = createCipheriv(BACKUP_ENC_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(csv, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/**
 * Sube un CSV construido con buildDeterministicCsv a Supabase Storage
 * (bucket privado "backups", migración 167) y deja el registro en
 * backup_job_runs. Ver honestidad de alcance en src/lib/backup-jobs.ts --
 * `destination` queda 'supabase_storage_fallback' hasta que existan
 * credenciales reales de B2/Glacier.
 *
 * El CSV se cifra con AES-256-GCM (BACKUP_ENCRYPTION_KEY) antes de subirlo
 * -- ver comentario de cabecera de este archivo. `storagePath` termina en
 * `.csv.enc` para que quede explícito que el contenido descargado no es un
 * CSV legible directamente.
 */
export async function storeBackupCsv(
  supabase: SupabaseClient,
  jobType: BackupJobType,
  headers: string[],
  rows: (string | number | null)[][],
  periodStartISO: string,
  periodEndISO: string
): Promise<{ success: boolean; storagePath?: string; sha256?: string; error?: string }> {
  const csv = buildDeterministicCsv(headers, rows);
  const sha256 = computeSha256Hex(csv);
  const encryptionKey = resolveBackupEncryptionKey();
  const encrypted = encryptBackupCsv(csv, encryptionKey);
  const storagePath = `${jobType}/${periodEndISO.slice(0, 10)}_${sha256.slice(0, 12)}.csv.enc`;

  const { error: uploadError } = await supabase.storage
    .from(BACKUP_BUCKET)
    .upload(storagePath, encrypted, { contentType: "application/octet-stream", upsert: false });

  if (uploadError) {
    await supabase.from("backup_job_runs").insert({
      job_type: jobType,
      period_start: periodStartISO,
      period_end: periodEndISO,
      destination: "supabase_storage_fallback",
      sha256_hash: sha256,
      row_count: rows.length,
      status: "failed",
      error_message: uploadError.message,
    });
    return { success: false, error: uploadError.message };
  }

  await supabase.from("backup_job_runs").insert({
    job_type: jobType,
    period_start: periodStartISO,
    period_end: periodEndISO,
    destination: "supabase_storage_fallback",
    storage_path: storagePath,
    sha256_hash: sha256,
    row_count: rows.length,
    status: "success",
  });

  return { success: true, storagePath, sha256 };
}
