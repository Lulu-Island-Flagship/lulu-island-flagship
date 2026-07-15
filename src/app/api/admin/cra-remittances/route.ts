import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { generateFullYearSchedule, isRemittanceOverdue } from "@/lib/cra-remittances";

/**
 * GET /api/admin/cra-remittances?year=2026 — v8.3 E9.4.
 *
 * Genera (si no existen) y devuelve el calendario de obligaciones CRA de
 * un año: CPP/EI mensual, GST/PST trimestral, T4 anual. Ver comentario de
 * alcance en src/lib/cra-remittances.ts -- esto es un recordatorio con
 * estado, no un motor de cálculo ni de NETFILE real.
 *
 * Recurso "compliance".
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getUTCFullYear()), 10);
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }

  const { data: existing, error: existingError } = await auth.supabase
    .from("cra_remittance_periods")
    .select("id, remittance_type, period_start, period_end, due_date, status, filed_at, confirmation_reference, amount_cents")
    .gte("period_start", `${year}-01-01`)
    .lte("period_end", `${year}-12-31`);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existingKeys = new Set((existing || []).map((p) => `${p.remittance_type}|${p.period_start}|${p.period_end}`));
  const generated = generateFullYearSchedule(year);
  const missing = generated.filter(
    (p) => !existingKeys.has(`${p.type}|${p.periodStartISO}|${p.periodEndISO}`)
  );

  if (missing.length > 0) {
    const { error: insertError } = await auth.supabase.from("cra_remittance_periods").insert(
      missing.map((p) => ({
        remittance_type: p.type,
        period_start: p.periodStartISO,
        period_end: p.periodEndISO,
        due_date: p.dueDateISO,
      }))
    );
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  const { data: fullYear, error: reloadError } = await auth.supabase
    .from("cra_remittance_periods")
    .select("id, remittance_type, period_start, period_end, due_date, status, filed_at, confirmation_reference, amount_cents")
    .gte("period_start", `${year}-01-01`)
    .lte("period_end", `${year}-12-31`)
    .order("due_date", { ascending: true });
  if (reloadError) {
    return NextResponse.json({ error: reloadError.message }, { status: 500 });
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const enriched = (fullYear || []).map((p) => ({
    ...p,
    overdue: isRemittanceOverdue(p.due_date, p.status as "pending" | "filed", todayISO),
  }));

  return NextResponse.json(
    { periods: enriched, overdueCount: enriched.filter((p) => p.overdue).length },
    { status: 200 }
  );
}
