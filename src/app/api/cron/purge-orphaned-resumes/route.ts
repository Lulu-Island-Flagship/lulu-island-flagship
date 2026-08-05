import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/admin";

// GET /api/cron/purge-orphaned-resumes
// Elimina archivos del bucket candidate-documents que:
// 1. Tienen más de 24 horas de antigüedad
// 2. No están referenciados por ninguna fila en la tabla documents
//
// Esto previene la acumulación de CVs sin consentimiento (PIPEDA).
// Se ejecuta como cron job (ver vercel.json para agregarlo).

const BUCKET = "candidate-documents";
const MAX_AGE_HOURS = 24;

export async function GET() {
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Service client unavailable" }, { status: 500 });
  }

  // Listar todos los archivos en el bucket
  const { data: files, error: listError } = await serviceClient.storage
    .from(BUCKET)
    .list("resumes");

  if (listError) {
    console.error("[purge-orphaned-resumes] Failed to list bucket:", listError.message);
    return NextResponse.json({ error: "Failed to list storage" }, { status: 500 });
  }

  if (!files || files.length === 0) {
    return NextResponse.json({ purged: 0, message: "No files to check" }, { status: 200 });
  }

  // Obtener todos los storage_paths que SÍ están referenciados en documents
  const { data: linkedDocs, error: docsError } = await serviceClient
    .from("documents")
    .select("storage_path")
    .eq("document_type", "resume");

  if (docsError) {
    console.error("[purge-orphaned-resumes] Failed to query documents:", docsError.message);
    return NextResponse.json({ error: "Failed to query documents" }, { status: 500 });
  }

  const linkedPaths = new Set((linkedDocs || []).map((d) => d.storage_path));

  const cutoffTime = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
  const orphanedPaths: string[] = [];

  for (const file of files) {
    const filePath = `resumes/${file.name}`;
    // Saltar archivos que sí están vinculados
    if (linkedPaths.has(filePath)) continue;

    // Verificar antigüedad usando el timestamp del nombre del archivo
    // Formato: resumes/<timestamp>-<random>.<ext>
    const match = file.name.match(/^(\d+)-/);
    if (match) {
      const fileTimestamp = parseInt(match[1], 10);
      if (!isNaN(fileTimestamp) && fileTimestamp < cutoffTime) {
        orphanedPaths.push(filePath);
      }
    }
  }

  if (orphanedPaths.length === 0) {
    return NextResponse.json({ purged: 0, message: "No orphaned files found" }, { status: 200 });
  }

  // Eliminar en lotes (Supabase Storage remove acepta array)
  const { error: removeError } = await serviceClient.storage
    .from(BUCKET)
    .remove(orphanedPaths);

  if (removeError) {
    console.error(
      `[purge-orphaned-resumes] Failed to remove ${orphanedPaths.length} orphaned files:`,
      removeError.message
    );
    return NextResponse.json(
      { error: "Failed to purge some files", purged: 0, failed: orphanedPaths.length },
      { status: 500 }
    );
  }

  console.log(`[purge-orphaned-resumes] Purged ${orphanedPaths.length} orphaned resume files`);
  return NextResponse.json({ purged: orphanedPaths.length }, { status: 200 });
}
