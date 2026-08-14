import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminRole } from "@/lib/admin";

import {
  prepareT4Submission,
  getSubmissionHistory,
  recordT4Submission,
  type T4SubmissionResult,
} from "@/lib/t4-submission";
import type { T4TransmitterContact } from "@/lib/t4-generator";

// =========================================================================
// Rate limit — máximo 5 generaciones T4 por hora por admin
// =========================================================================

const T4_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hora
const T4_RATE_LIMIT_MAX = 5;

async function checkT4RateLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ limited: boolean; retryAfterSecs: number }> {
  const windowStart = new Date(Date.now() - T4_RATE_LIMIT_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from("admin_action_logs")
    .select("created_at")
    .eq("user_id", userId)
    .eq("resource", "finance")
    .eq("method", "T4_SUBMIT")
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false });

  if (error || !data) {
    // Fail open: permitir si no podemos verificar el rate limit
    console.error("t4/route: rate limit check failed, allowing:", error);
    return { limited: false, retryAfterSecs: 0 };
  }

  if (data.length >= T4_RATE_LIMIT_MAX) {
    const oldestInWindow = new Date(
      (data[data.length - 1] as { created_at: string }).created_at,
    );
    const retryAfterMs =
      oldestInWindow.getTime() + T4_RATE_LIMIT_WINDOW_MS - Date.now();
    return {
      limited: true,
      retryAfterSecs: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  return { limited: false, retryAfterSecs: 0 };
}

// =========================================================================
// GET /api/admin/tax/t4 — historial de envíos T4
// =========================================================================

/**
 * Recupera el historial de envíos T4 generados.
 *
 * Query params:
 *   - limit (opcional, default 10): número máximo de registros.
 *
 * Auth: solo owner_admin (resource "finance").
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", {
    method: request.method,
    url: request.url,
  });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10),
    100,
  );

  try {
    const history = await getSubmissionHistory(supabase, limit);
    return NextResponse.json({ history });
  } catch (err) {
    console.error("t4/route: error fetching history:", err);
    return NextResponse.json(
      { error: "Error interno al consultar historial T4" },
      { status: 500 },
    );
  }
}

// =========================================================================
// POST /api/admin/tax/t4 — genera T4 submission XML
// =========================================================================

/**
 * Genera el XML de transmisión T4 (T619 + slips) para un año fiscal.
 *
 * Body (JSON):
 *   - anio: número (required) — año fiscal, ej. 2026.
 *   - contact: objeto (opcional) — { contactName, contactPhone, contactEmail }.
 *
 * Rate limit: máximo 5 generaciones por admin por hora.
 *
 * Auth: solo owner_admin (resource "finance").
 *
 * Response (200):
 *   - xml: string — XML T619 completo.
 *   - summaryHtml: string — HTML del T4 Summary para revisión.
 *   - validation: { valid, errors, warnings } — resultado de validación.
 *   - slips: number — cantidad de T4 slips generados.
 *   - totals: { employmentIncomeCents, incomeTaxDeductedCents, ... }
 *   - filingDeadline, issuanceDeadline: string — fechas límite ISO.
 */
export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const auth = await requireAdminRole("finance", {
    method: request.method,
    url: request.url,
  });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, user } = auth;
  if (!supabase || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Rate limit ────────────────────────────────────────────────────────
  const rateLimit = await checkT4RateLimit(supabase, user.id);
  if (rateLimit.limited) {
    return NextResponse.json(
      {
        error:
          "Rate limit exceeded. Maximum " +
          T4_RATE_LIMIT_MAX +
          " T4 submissions per hour.",
        retryAfterSecs: rateLimit.retryAfterSecs,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSecs),
          "X-RateLimit-Limit": String(T4_RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(
            Math.ceil((Date.now() + rateLimit.retryAfterSecs * 1000) / 1000),
          ),
        },
      },
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────
  let body: { anio?: number; contact?: T4TransmitterContact };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body debe ser JSON válido con { anio: number }" },
      { status: 400 },
    );
  }

  const anio = body.anio;
  if (!anio || !Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    return NextResponse.json(
      {
        error:
          "anio es requerido y debe ser un entero entre 2000 y 2100 (ej. 2026)",
      },
      { status: 400 },
    );
  }

  // Validate contact if provided
  const contact = body.contact;
  if (contact !== undefined) {
    if (
      typeof contact !== "object" ||
      typeof contact.contactName !== "string" ||
      typeof contact.contactPhone !== "string" ||
      typeof contact.contactEmail !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "contact debe ser un objeto con { contactName, contactPhone, contactEmail }",
        },
        { status: 400 },
      );
    }
  }

  // ── Generate submission ───────────────────────────────────────────────
  

  try {
    const result: T4SubmissionResult = await prepareT4Submission(
      supabase,
      anio,
      contact,
    );

    // ── Record submission ───────────────────────────────────────────────
    const recorded = await recordT4Submission(supabase, user.id, result);
    if (!recorded) {
      console.warn(
        "t4/route: T4 submission generated but audit log insert failed for user=" +
          user.id +
          " anio=" +
          anio,
      );
    }

    // ── Response ────────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      anio: result.anio,
      xml: result.xml,
      summaryHtml: result.summaryHtml,
      validation: result.validation,
      slips: result.summary.totalSlips,
      totals: {
        employmentIncomeCents: result.summary.totals.employmentIncomeCents,
        cppEmployeeCents: result.summary.totals.cppEmployeeCents,
        eiEmployeeCents: result.summary.totals.eiEmployeeCents,
        incomeTaxDeductedCents: result.summary.totals.incomeTaxDeductedCents,
        eiInsurableEarningsCents: result.summary.totals.eiInsurableEarningsCents,
        cppPensionableEarningsCents:
          result.summary.totals.cppPensionableEarningsCents,
      },
      filingDeadline: result.filingDeadline,
      issuanceDeadline: result.issuanceDeadline,
      generatedAt: result.generatedAt,
      auditLogged: recorded,
    });
  } catch (err) {
    console.error("t4/route: error generating T4 submission:", err);
    // Fix (auditoría MANIFEST v4.2 · F.1): no exponer err.message crudo al
    // cliente; el detalle técnico queda en el log de servidor de arriba.
    return NextResponse.json(
      { error: "Error interno al generar T4 submission" },
      { status: 500 },
    );
  }
}
