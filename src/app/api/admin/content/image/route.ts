import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction, getServiceRoleClient } from "@/lib/admin";

/**
 * POST /api/admin/content/image — upload image to landing-images bucket
 *   Body: FormData with fields "slot" (image.hero|image.divider1|image.divider2)
 *         and "file" (the image file)
 *
 * DELETE /api/admin/content/image — remove image from bucket and site_content
 *   Body: { slot: "image.hero" }
 */

const ALLOWED_SLOTS = ["image.hero", "image.divider1", "image.divider2"];

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("site_content", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "site_content", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  const formData = await request.formData();
  const slot = formData.get("slot") as string;
  const file = formData.get("file") as File;

  if (!slot || !ALLOWED_SLOTS.includes(slot)) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  // Fix (auditoría MANIFEST v4.2 · C.1 sanitización de subida): tamaño y MIME
  // validados en servidor (file.type/file.name son controlados por el cliente).
  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Image too large (max 5 MB)" }, { status: 413 });
  }
  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
  if (!ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json({ error: "Invalid image type" }, { status: 415 });
  }

  // Extensión derivada del MIME validado, no del nombre del archivo.
  const EXT_BY_MIME: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  };
  const ext = EXT_BY_MIME[file.type] || "jpg";
  const filename = `${slot}_${Date.now()}.${ext}`;

  const { error: uploadError } = await auth.supabase.storage
    .from("landing-images")
    .upload(filename, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  // Get public URL
  const { data: urlData } = auth.supabase.storage
    .from("landing-images")
    .getPublicUrl(filename);

  const publicUrl = urlData.publicUrl;

  // Save URL to site_content — escritura service_role (migración 369)
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Service client unavailable" }, { status: 500 });
  }
  const { error: dbError } = await serviceClient
    .from("site_content")
    .upsert({ key: slot, value: publicUrl, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (dbError) {
    return NextResponse.json({ error: "Failed to save URL" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, slot, url: publicUrl });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminRole("site_content", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "site_content", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });
  const { slot } = body;

  if (!slot || !ALLOWED_SLOTS.includes(slot)) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }

  // Get current URL from site_content to find the filename
  const { data: existing } = await auth.supabase
    .from("site_content")
    .select("value")
    .eq("key", slot)
    .single();

  if (existing?.value) {
    // Extract filename from URL
    const url = new URL(existing.value);
    const pathParts = url.pathname.split("/");
    const filename = pathParts[pathParts.length - 1];

    if (filename) {
      // Delete from storage (ignore errors — file may already be gone)
      await auth.supabase.storage.from("landing-images").remove([filename]);
    }
  }

  // Remove key from site_content — escritura service_role (migración 369)
  const svcClient = getServiceRoleClient();
  if (svcClient) {
    await svcClient
      .from("site_content")
      .delete()
      .eq("key", slot);
  }

  return NextResponse.json({ ok: true, slot });
}
