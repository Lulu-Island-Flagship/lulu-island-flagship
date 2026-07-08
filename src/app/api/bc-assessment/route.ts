import { NextRequest, NextResponse } from "next/server";
import { lookupBcAssessment } from "@/lib/bc-assessment";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address || address.trim().length === 0) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  const result = await lookupBcAssessment(address.trim());
  return NextResponse.json(result, { status: 200 });
}
