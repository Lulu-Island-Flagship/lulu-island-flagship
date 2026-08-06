import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

/**
 * GET /api/content/landing — public, no auth.
 * Returns all site_content key-value pairs for the landing page.
 * Cached for 60s (ISR-compatible).
 */
export async function GET() {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("site_content")
    .select("key, value");

  if (error) {
    return NextResponse.json({ error: "Failed to load content" }, { status: 500 });
  }

  // Convert rows to { key: value } map
  const content: Record<string, string> = {};
  for (const row of data ?? []) {
    content[row.key] = row.value;
  }

  return NextResponse.json(
    { content },
    {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}
