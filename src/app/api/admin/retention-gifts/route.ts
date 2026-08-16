import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { evaluateResidentialGiftEligibility } from "@/lib/gift-program";
import { safeErrorResponse } from "@/lib/api-errors";
import { dollarsToCents } from "@/lib/currency";

// GET /api/admin/retention-gifts — listar regalos registrados
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("retention_gifts")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("admin/retention-gifts error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ gifts: data || [] }, { status: 200 });
}

// POST /api/admin/retention-gifts — evalua elegibilidad y registra el regalo
// sugerido (D.9.11). Si requiere aprobacion manual (regalo > LTV), queda sin
// approved_at hasta que alguien lo apruebe explicitamente.
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logResult = await logAdminAction({
    supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  try {
    const body = await request.json();
    const { clientUserId, monthsActive, firstYearValueCents, ltvCents } = body;

    if (!clientUserId || monthsActive === undefined || firstYearValueCents === undefined) {
      return NextResponse.json({ error: "clientUserId, monthsActive y firstYearValueCents son requeridos" }, { status: 400 });
    }

    const evaluation = evaluateResidentialGiftEligibility(
      monthsActive,
      firstYearValueCents / 100,
      (ltvCents ?? 0) / 100
    );

    if (!evaluation.eligible) {
      return NextResponse.json({ eligible: false, reason: evaluation.reason }, { status: 200 });
    }

    const { data, error } = await supabase
      .from("retention_gifts")
      .insert({
        client_user_id: clientUserId,
        months_active: monthsActive,
        first_year_value_cents: firstYearValueCents,
        tier: evaluation.tier!.tier,
        suggested_gift_cents: dollarsToCents(evaluation.suggestedGiftDollars!),
        requires_manual_approval: evaluation.requiresManualApproval ?? false,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/retention-gifts error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ eligible: true, gift: data, evaluation }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}
