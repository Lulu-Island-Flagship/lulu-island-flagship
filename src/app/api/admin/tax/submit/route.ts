/**
 * POST /api/admin/tax/submit — Endpoint unificado de envío fiscal a CRA.
 *
 * Centraliza el envío de GST/HST returns, T4 slips, y T4A slips a la
 * Canada Revenue Agency (CRA). Es el punto de entrada único para que un
 * owner_admin envíe declaraciones fiscales electrónicamente.
 *
 * ## Endpoints
 *
 * ### POST /api/admin/tax/submit
 *   Envía una declaración fiscal a CRA.
 *
 *   Body (JSON):
 *   ```json
 *   {
 *     "tipo": "gst" | "t4" | "t4a",
 *     "periodo": "2026-Q2",
 *     "anio": 2026
 *   }
 *   ```
 *
 *   Response (200):
 *   ```json
 *   {
 *     "success": true,
 *     "submission_id": "uuid",
 *     "tipo": "gst",
 *     "periodo": "2026-Q2",
 *     "referencia_cra": "GST-2026-123456789",
 *     "estado": "ACCEPTED",
 *     "mensaje": "...",
 *     "xml_hash": "sha256...",
 *     "fecha_envio": "2026-08-05T..."
 *   }
 *   ```
 *
 * ### GET /api/admin/tax/submit
 *   Consulta el historial de envíos fiscales.
 *
 *   Query params:
 *   - limit (opcional, default 50, max 200)
 *   - tipo (opcional: "gst" | "t4" | "t4a" | "roe")
 *   - anio (opcional)
 *
 * ## Auth
 *
 * Requiere rol "finance" vía requireAdminRole() — solo owner_admin.
 *
 * ## Rate Limit
 *
 * Máximo 1 envío por hora por admin. Este límite es conservador porque:
 * 1. CRA penaliza envíos duplicados o excesivos.
 * 2. Cada envío requiere que un contador revise el XML antes.
 * 3. La transmisión real a CRA sigue siendo manual (placeholder),
 *    así que no hay urgencia de alto volumen.
 *
 * ## Registro de auditoría
 *
 * Cada envío queda registrado en DOS lugares:
 * 1. `admin_action_logs` — vía requireAdminRole() (quién, qué recurso, cuándo).
 * 2. `tax_submission_log` — vía logSubmission() (tipo, XML hash, resultado CRA).
 *
 * ## Placeholders de API CRA
 *
 * Las funciones de envío (`submitGstReturn`, `submitT4Return`, `submitT4AReturn`)
 * en `cra-client.ts` son PLACEHOLDERS — generan el XML correctamente pero NO
 * lo transmiten a CRA. La transmisión real requiere certificación de software
 * ante CRA (PKI). Mientras tanto, el admin descarga el XML y lo sube
 * manualmente al portal CRA My Business Account.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAdminRole, getServiceRoleClient, logAdminAction } from "@/lib/admin";
import { captureError } from "@/lib/observability";
import { getClientIp } from "@/lib/request-ip";

// CRA client (placeholder)
import {
  submitGstReturn,
  submitT4Return,
  submitT4AReturn,
} from "@/lib/cra-client";

// Tax submission log
import {
  logSubmission,
  getSubmissionHistory,
  type TaxSubmissionType,
} from "@/lib/tax-submission-log";

// XML generators
import { generateGstReturnXml, type GstReturnXmlInput } from "@/lib/tax-netfile";
import { prepareT4Submission, type T4SubmissionResult } from "@/lib/t4-submission";
import {
  generateT4ASlip,
  generateT4ASubmissionXml,
  generateT4ASummary,
  buildT4AAggregate,
  getT4AFilingDeadline,
  type T4ASlip,
} from "@/lib/t4a-generator";
import { type PartnerType } from "@/lib/partner-commissions";

// =========================================================================
// Rate limit — 1 envío por hora por admin
// =========================================================================

const SUBMIT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hora
const SUBMIT_RATE_LIMIT_MAX = 1;

/**
 * Verifica el rate limit de envíos fiscales consultando `admin_action_logs`.
 *
 * Busca acciones previas del mismo admin con resource="finance" y
 * method="TAX_SUBMIT" en la última hora. Si ya alcanzó el límite,
 * bloquea el envío.
 *
 * Este rate limit es INDEPENDIENTE del rate limit de generación de T4
 * (5/hora en t4/route.ts) porque una cosa es GENERAR el XML para revisar
 * y otra muy distinta es ENVIARLO a CRA.
 *
 * @param supabase — Cliente Supabase (anon + cookies, de requireAdminRole).
 * @param userId — UUID del admin.
 * @returns Si está limitado y cuántos segundos debe esperar.
 */
async function checkSubmitRateLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ limited: boolean; retryAfterSecs: number }> {
  const windowStart = new Date(
    Date.now() - SUBMIT_RATE_LIMIT_WINDOW_MS,
  ).toISOString();

  const { data, error } = await supabase
    .from("admin_action_logs")
    .select("created_at")
    .eq("user_id", userId)
    .eq("resource", "finance")
    .eq("method", "TAX_SUBMIT")
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false });

  if (error || !data) {
    // Fail open: si no podemos verificar, permitir (pero loguear)
    console.error("tax/submit: rate limit check failed, allowing:", error);
    return { limited: false, retryAfterSecs: 0 };
  }

  if (data.length >= SUBMIT_RATE_LIMIT_MAX) {
    const oldestInWindow = new Date(
      (data[data.length - 1] as { created_at: string }).created_at,
    );
    const retryAfterMs =
      oldestInWindow.getTime() + SUBMIT_RATE_LIMIT_WINDOW_MS - Date.now();
    return {
      limited: true,
      retryAfterSecs: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  return { limited: false, retryAfterSecs: 0 };
}

// =========================================================================
// Zod schemas
// =========================================================================

const SubmitBodySchema = z.object({
  tipo: z.enum(["gst", "t4", "t4a"]),
  periodo: z.string().min(1),
  anio: z
    .number()
    .int()
    .min(2000)
    .max(2100),
});

const GetQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v ?? "50", 10);
      return Number.isNaN(n) ? 50 : n;
    }),
  tipo: z.enum(["gst", "t4", "t4a", "roe"]).optional(),
  anio: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? undefined : n;
    }),
});

// =========================================================================
// GET /api/admin/tax/submit — historial de envíos
// =========================================================================

/**
 * Recupera el historial de envíos fiscales desde `tax_submission_log`.
 *
 * Query params opcionales:
 *   - limit: número de registros (default 50, max 200)
 *   - tipo: filtrar por tipo ("gst", "t4", "t4a", "roe")
 *   - anio: filtrar por año fiscal
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

  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Service role client not available" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);

  let limit = 50;
  let tipo: TaxSubmissionType | undefined;
  let anio: number | undefined;

  try {
    const rawLimit = searchParams.get("limit");
    const rawTipo = searchParams.get("tipo");
    const rawAnio = searchParams.get("anio");

    const parsed = GetQuerySchema.safeParse({
      limit: rawLimit,
      tipo: rawTipo,
      anio: rawAnio,
    });

    if (parsed.success) {
      limit = Math.min(Math.max(1, parsed.data.limit), 200);
      tipo = parsed.data.tipo;
      anio = parsed.data.anio;
    }
    // Si falla el parseo, usamos defaults (ya declarados arriba)
  } catch {
    // defaults
  }

  try {
    const history = await getSubmissionHistory(serviceClient, limit, tipo, anio);
    return NextResponse.json({ history, count: history.length });
  } catch (err) {
    captureError(err instanceof Error ? err : new Error(String(err)), {
      fn: "tax/submit GET",
    });
    return NextResponse.json(
      { error: "Error interno al consultar historial de envíos" },
      { status: 500 },
    );
  }
}

// =========================================================================
// POST /api/admin/tax/submit — envío unificado
// =========================================================================

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

  const logResult = await logAdminAction({
    supabase, user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  // ── Rate limit ────────────────────────────────────────────────────────
  const rateLimit = await checkSubmitRateLimit(supabase, user.id);
  if (rateLimit.limited) {
    return NextResponse.json(
      {
        error:
          "Rate limit exceeded. Maximum " +
          SUBMIT_RATE_LIMIT_MAX +
          " tax submission per hour. " +
          "CRA only accepts one filing per period — verify before retrying.",
        retryAfterSecs: rateLimit.retryAfterSecs,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSecs),
          "X-RateLimit-Limit": String(SUBMIT_RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(
            Math.ceil((Date.now() + rateLimit.retryAfterSecs * 1000) / 1000),
          ),
        },
      },
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body debe ser JSON válido" },
      { status: 400 },
    );
  }

  const parsed = SubmitBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Body inválido",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { tipo, periodo, anio } = parsed.data;
  const clientIp = getClientIp(request);

  // ── Get service role client for DB writes ─────────────────────────────
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    captureError(
      new Error("tax/submit: service role client not available"),
      { fn: "POST tax/submit", tipo, periodo, anio },
    );
    return NextResponse.json(
      { error: "Error de configuración del servidor — contacte al administrador" },
      { status: 500 },
    );
  }

  // ── Dispatch by tipo ──────────────────────────────────────────────────
  try {
    switch (tipo) {
      case "gst":
        return await handleGstSubmit(serviceClient, supabase, user.id, periodo, anio, clientIp);
      case "t4":
        return await handleT4Submit(serviceClient, supabase, user.id, anio, clientIp);
      case "t4a":
        return await handleT4ASubmit(serviceClient, supabase, user.id, anio, clientIp);
      default: {
        // TypeScript debería agotar el union type aquí
        const _exhaustive: never = tipo;
        return NextResponse.json(
          { error: `Tipo de envío no soportado: ${_exhaustive}` },
          { status: 400 },
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    captureError(err instanceof Error ? err : new Error(message), {
      fn: "POST tax/submit",
      tipo,
      periodo,
      anio,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Error interno al procesar el envío: " + message },
      { status: 500 },
    );
  }
}

// =========================================================================
// Handler: GST
// =========================================================================

/**
 * Maneja el envío de un GST/HST return a CRA.
 *
 * Flujo:
 * 1. Construye el input para generateGstReturnXml() con valores por defecto
 *    seguros para el período (los montos reales deben venir del ledger —
 *    en producción, el admin debe revisar y ajustar antes de enviar).
 * 2. Genera el XML T619.
 * 3. Llama a submitGstReturn() (placeholder).
 * 4. Registra en tax_submission_log.
 *
 * NOTA: los montos actuales (gstCollectedCents, gstItcCents) se dejan en 0
 * porque este endpoint es para ENVÍO, no para cálculo. El admin debe haber
 * revisado el XML generado por /api/admin/tax/netfile antes de llamar a
 * este endpoint.
 */
async function handleGstSubmit(
  serviceClient: NonNullable<ReturnType<typeof getServiceRoleClient>>,
  supabase: SupabaseClient,
  adminId: string,
  periodo: string,
  anio: number,
  _clientIp: string,
) {
  // ── Generar XML ──────────────────────────────────────────────────────
  // NOTA: en una versión futura, el admin podrá pasar los montos en el body.
  // Por ahora se generan con defaults seguros (ceros) — el XML es correcto
  // estructuralmente pero requiere que el contador ajuste los montos antes
  // del envío REAL a CRA.
  const input: GstReturnXmlInput = {
    periodo,
    gstCollectedCents: 0,
    gstItcCents: 0,
    pstCollectedCents: 0,
    totalSalesCents: 0,
    businessNumber: "123456789RT0001",
  };

  const xml = generateGstReturnXml(input);

  // ── Enviar a CRA (placeholder) ───────────────────────────────────────
  const result = await submitGstReturn(xml, periodo);

  // ── Registrar en tax_submission_log ──────────────────────────────────
  const logResult = await logSubmission(serviceClient, {
    tipo: "gst",
    periodo,
    anio,
    xml_hash: result.xmlHash,
    resultado: result.estado,
    referencia_cra: result.referenciaCRA,
    admin_id: adminId,
  });

  if (logResult.error) {
    console.error(
      "tax/submit: GST submission sent but log failed:",
      logResult.error,
    );
  }

  return NextResponse.json({
    success: result.estado === "ACCEPTED",
    submission_id: logResult.row?.submission_id ?? null,
    tipo: "gst",
    periodo,
    anio,
    referencia_cra: result.referenciaCRA,
    estado: result.estado,
    mensaje: result.mensaje,
    xml_hash: result.xmlHash,
    fecha_envio: result.fechaRespuesta,
    audit_logged: logResult.row !== null,
  });
}

// =========================================================================
// Handler: T4
// =========================================================================

/**
 * Maneja el envío de T4 slips a CRA.
 *
 * Flujo:
 * 1. Orquesta prepareT4Submission() — que consulta payroll_linea,
 *    employees, genera slips, summary, XML T619 y valida.
 * 2. Llama a submitT4Return() (placeholder).
 * 3. Registra en tax_submission_log.
 */
async function handleT4Submit(
  serviceClient: NonNullable<ReturnType<typeof getServiceRoleClient>>,
  supabase: SupabaseClient,
  adminId: string,
  anio: number,
  _clientIp: string,
) {
  // ── Generar submission completa ──────────────────────────────────────
  const t4Result: T4SubmissionResult = await prepareT4Submission(supabase, anio);

  if (!t4Result.validation.valid) {
    // El XML no pasó validación — no se debe enviar a CRA
    const errorMsg =
      "T4 XML no pasó validación: " +
      t4Result.validation.errors.join("; ");
    captureError(new Error(errorMsg), {
      fn: "handleT4Submit",
      anio,
      validationErrors: t4Result.validation.errors,
    });

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        validation: t4Result.validation,
        anio,
        slips: t4Result.summary.totalSlips,
      },
      { status: 422 },
    );
  }

  // ── Enviar a CRA (placeholder) ───────────────────────────────────────
  const result = await submitT4Return(t4Result.xml, anio);

  // ── Registrar en tax_submission_log ──────────────────────────────────
  const logResult = await logSubmission(serviceClient, {
    tipo: "t4",
    periodo: String(anio),
    anio,
    xml_hash: result.xmlHash,
    resultado: result.estado,
    referencia_cra: result.referenciaCRA,
    admin_id: adminId,
  });

  if (logResult.error) {
    console.error(
      "tax/submit: T4 submission sent but log failed:",
      logResult.error,
    );
  }

  return NextResponse.json({
    success: result.estado === "ACCEPTED",
    submission_id: logResult.row?.submission_id ?? null,
    tipo: "t4",
    periodo: String(anio),
    anio,
    referencia_cra: result.referenciaCRA,
    estado: result.estado,
    mensaje: result.mensaje,
    xml_hash: result.xmlHash,
    fecha_envio: result.fechaRespuesta,
    slips: t4Result.summary.totalSlips,
    totals: {
      employmentIncomeCents: t4Result.summary.totals.employmentIncomeCents,
      incomeTaxDeductedCents: t4Result.summary.totals.incomeTaxDeductedCents,
      cppEmployeeCents: t4Result.summary.totals.cppEmployeeCents,
      eiEmployeeCents: t4Result.summary.totals.eiEmployeeCents,
    },
    filingDeadline: t4Result.filingDeadline,
    audit_logged: logResult.row !== null,
  });
}

// =========================================================================
// Handler: T4A
// =========================================================================

/**
 * Maneja el envío de T4A slips a CRA.
 *
 * Flujo:
 * 1. Consulta los datos de partners desde la BD (partner_commissions).
 * 2. Agrega por partner y genera T4A slips.
 * 3. Genera T4A Summary y XML T619.
 * 4. Llama a submitT4AReturn() (placeholder).
 * 5. Registra en tax_submission_log.
 *
 * NOTA: este handler requiere que la tabla `partner_commissions` tenga
 * datos para el año fiscal. Si no hay partners con pagos en el año, se
 * genera un T4A vacío (sin slips) — esto es válido (nil return).
 *
 * TODO: extraer la lógica de agregación de partner_commissions a un
 * `prepareT4ASubmission()` en un futuro módulo orquestador, mismo patrón
 * que `prepareT4Submission()` para T4.
 */
async function handleT4ASubmit(
  serviceClient: NonNullable<ReturnType<typeof getServiceRoleClient>>,
  supabase: SupabaseClient,
  adminId: string,
  anio: number,
  _clientIp: string,
) {
  // ── Consultar partner commissions del año ────────────────────────────
  const anioStr = String(anio);
  const slips: T4ASlip[] = [];

  try {
    // Query partner_commissions para el año fiscal
    const { data: commissions, error: commError } = await supabase
      .from("partner_commissions")
      .select("*")
      .gte("created_at", anioStr + "-01-01")
      .lte("created_at", anioStr + "-12-31");

    if (commError) {
      captureError(commError, {
        fn: "handleT4ASubmit",
        table: "partner_commissions",
        anio,
      });
      // Continuar con slips vacíos — nil return es válido
    }

    if (commissions && commissions.length > 0) {
      // ── Agregar por partner ──────────────────────────────────────────
      // Agrupamos por partner_id y sumamos los montos
      const partnerMap = new Map<
        string,
        {
          partnerId: string;
          legalName: string;
          partnerType: string;
          totalCents: number;
        }
      >();

      for (const comm of commissions as Array<{
        partner_id: string;
        partner_name?: string;
        partner_type: string;
        commission_cents: number;
      }>) {
        const existing = partnerMap.get(comm.partner_id);
        if (existing) {
          existing.totalCents += comm.commission_cents;
        } else {
          partnerMap.set(comm.partner_id, {
            partnerId: comm.partner_id,
            legalName: comm.partner_name ?? "Partner " + comm.partner_id.slice(0, 8),
            partnerType: comm.partner_type,
            totalCents: comm.commission_cents,
          });
        }
      }

      // ── Generar T4A slips ────────────────────────────────────────────
      // También necesitamos los datos de dirección de cada partner
      // Consultar tabla partners para obtener dirección y BN/SIN
      const partnerIds = [...partnerMap.keys()];
      const { data: partners } = await supabase
        .from("partners")
        .select("id, name, address_line1, address_city, address_province, address_postal_code, business_number")
        .in("id", partnerIds);

      const partnerInfoMap = new Map<
        string,
        {
          name: string;
          address: { line1: string; city: string; province: string; postalCode: string };
          businessNumber: string;
        }
      >();

      for (const p of (partners ?? []) as Array<{
        id: string;
        name: string;
        address_line1?: string;
        address_city?: string;
        address_province?: string;
        address_postal_code?: string;
        business_number?: string;
      }>) {
        partnerInfoMap.set(p.id, {
          name: p.name,
          address: {
            line1: p.address_line1 ?? "Address on file",
            city: p.address_city ?? "Vancouver",
            province: p.address_province ?? "BC",
            postalCode: p.address_postal_code ?? "V6Z 0E2",
          },
          businessNumber: p.business_number ?? "000000000RP0001",
        });
      }

      for (const [partnerId, agg] of partnerMap) {
        const info = partnerInfoMap.get(partnerId);
        if (!info) continue;

        const pt = agg.partnerType as PartnerType;
        const aggregate = buildT4AAggregate(agg.totalCents, pt);

        const slip = generateT4ASlip(
          {
            partnerId,
            legalName: info.name,
            partnerType: pt,
            address: info.address,
            recipientBN: info.businessNumber,
            isBusinessNumber: true,
          },
          aggregate,
          anio,
        );

        slips.push(slip);
      }
    }
  } catch (err) {
    captureError(err instanceof Error ? err : new Error(String(err)), {
      fn: "handleT4ASubmit.partnerQuery",
      anio,
    });
    // Continuar con slips vacíos — nil return es válido
  }

  // ── Generar T4A Summary ──────────────────────────────────────────────
  const summary = generateT4ASummary(slips, anio);

  // ── Generar XML T619 ─────────────────────────────────────────────────
  // generateT4ASubmissionXml internamente llama a generateT4ASummary,
  // pero como ya lo tenemos calculado, pasamos opts vacío (default).
  const xml = generateT4ASubmissionXml(anio);

  // ── Enviar a CRA (placeholder) ───────────────────────────────────────
  const result = await submitT4AReturn(xml, anio);

  // ── Registrar en tax_submission_log ──────────────────────────────────
  const logResult = await logSubmission(serviceClient, {
    tipo: "t4a",
    periodo: String(anio),
    anio,
    xml_hash: result.xmlHash,
    resultado: result.estado,
    referencia_cra: result.referenciaCRA,
    admin_id: adminId,
  });

  if (logResult.error) {
    console.error(
      "tax/submit: T4A submission sent but log failed:",
      logResult.error,
    );
  }

  return NextResponse.json({
    success: result.estado === "ACCEPTED",
    submission_id: logResult.row?.submission_id ?? null,
    tipo: "t4a",
    periodo: String(anio),
    anio,
    referencia_cra: result.referenciaCRA,
    estado: result.estado,
    mensaje: result.mensaje,
    xml_hash: result.xmlHash,
    fecha_envio: result.fechaRespuesta,
    slips: summary.totalSlips,
    totals: {
      selfEmployedCommissionsCents: summary.totals.selfEmployedCommissionsCents,
      feesForServicesCents: summary.totals.feesForServicesCents,
      incomeTaxDeductedCents: summary.totals.incomeTaxDeductedCents,
      otherIncomeCents: summary.totals.otherIncomeCents,
    },
    filingDeadline: getT4AFilingDeadline(anio),
    audit_logged: logResult.row !== null,
  });
}
