import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

// POST /api/admin/safety-aborts/[id]/acknowledge — un admin (cualquier nivel)
// confirma que está atendiendo el SOS. Detiene la escalación automática
// hacia adelante (no revierte el reloj, solo lo congela).
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { data: acker } = await auth.supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user.id)
      .single();

    const { data, error } = await auth.supabase
      .from("safety_aborts")
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: acker?.id || null,
        stage: "acknowledged",
      })
      .eq("id", params.id)
      .is("deleted_at", null)
      .select()
      .single();

    if (error) {
      console.error("admin/safety-aborts/[id]/acknowledge error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ safetyAbort: data }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}
