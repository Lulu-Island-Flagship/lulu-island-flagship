import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ALLOWED_MIME_TYPES, detectMimeTypeFromBytes } from "@/lib/hiring-flow/document-service";
import { checkRateLimit } from "@/lib/hiring-flow/rate-limiter";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key);
}

// POST /api/hiring-flow/upload-resume
// Endpoint público (sin auth) para que candidatos suban su CV/hoja de vida
// junto con su aplicación. Acepta multipart/form-data con un solo archivo
// (campo "resume"). Devuelve un `documentId` que se puede enviar en el
// campo `resumeDocumentId` del POST /api/hiring-flow/apply.

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const BUCKET_NAME = "candidate-documents";

export async function POST(request: NextRequest) {
  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const rateLimitResult = await checkRateLimit(`upload_resume:ip:${ipAddress}`, "hiring_flow_upload_resume_ip_max_requests");
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: "Too many upload attempts. Please try again later." },
      { status: 429 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("resume");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing "resume" file in form data' },
      { status: 400 }
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File size exceeds ${MAX_FILE_SIZE_MB}MB limit` },
      { status: 400 }
    );
  }

  // Leer bytes reales para validar magic numbers
  let bytes: Uint8Array;
  try {
    const arrayBuffer = await file.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  } catch {
    return NextResponse.json(
      { error: "Could not read file contents" },
      { status: 400 }
    );
  }

  const detectedMimeType = detectMimeTypeFromBytes(bytes);
  if (!detectedMimeType) {
    return NextResponse.json(
      {
        error:
          "Unsupported file type. Accepted formats: PDF, JPEG, PNG, WebP.",
      },
      { status: 400 }
    );
  }

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(detectedMimeType)) {
    return NextResponse.json(
      {
        error: `File type "${detectedMimeType}" is not accepted for resumes. Use PDF, JPEG, PNG, or WebP.`,
      },
      { status: 400 }
    );
  }

  const supabase = getServiceClient();

  // Generar path único: resumes/<timestamp>-<random>.<ext>
  const ext = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "pdf";
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).slice(2, 8);
  const storagePath = `resumes/${timestamp}-${randomPart}.${ext}`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, file, {
      contentType: detectedMimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error(
      "[upload-resume] Failed to upload file to Supabase Storage:",
      uploadError.message
    );
    return NextResponse.json(
      { error: "Failed to store the uploaded file. Please try again." },
      { status: 500 }
    );
  }

  // El archivo ya está en Storage. El registro en la tabla `documents`
  // (que requiere candidate_id NOT NULL) se crea en el endpoint de apply
  // después de que el candidato queda registrado -- el frontend envía
  // `resumeStoragePath` junto con los datos del formulario.
  return NextResponse.json(
    {
      storagePath,
      fileName: file.name,
      fileType: detectedMimeType,
      fileSize: bytes.length,
    },
    { status: 200 }
  );
}
