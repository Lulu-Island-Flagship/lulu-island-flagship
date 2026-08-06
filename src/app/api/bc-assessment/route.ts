import { NextRequest, NextResponse } from "next/server";
import { lookupBcAssessment } from "@/lib/bc-assessment";

// Fix (auditoría 2026-08-06): rate limiter in-memory para prevenir abuso
// del proxy a BC Assessment API. 10 req/min por IP. En serverless (Vercel)
// el Map se resetea en cada cold start, lo cual es aceptable para este nivel
// de protección. Para producción se recomienda Redis o similar.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function GET(request: NextRequest) {
  // Rate limit check
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429 }
      );
    }
    entry.count++;
  } else {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  }

  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address || address.trim().length === 0) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  const result = await lookupBcAssessment(address.trim());
  return NextResponse.json(result, { status: 200 });
}
