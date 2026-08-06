import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

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

  const formData = await request.formData();
  const slot = formData.get("slot") as string;
  const file = formData.get("file") as File;

  if (!slot || !ALLOWED_SLOTS.includes(slot)) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  // Generate unique filename: slot_timestamp.extension
  const ext = file.name.split(".").pop() || "jpg";
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

  // Save URL to site_content
  const { error: dbError } = await auth.supabase
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

  const body = await request.json();
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

  // Remove key from site_content
  await auth.supabase
    .from("site_content")
    .delete()
    .eq("key", slot);

  return NextResponse.json({ ok: true, slot });
}
