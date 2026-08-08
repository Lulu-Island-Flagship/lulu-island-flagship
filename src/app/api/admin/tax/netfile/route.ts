/**
 * POST /api/admin/tax/netfile — GST/HST NETFILE Return Generator.
 *
 * Genera y descarga el XML de GST/HST Return en formato CRA T619 para
 * presentación electrónica (NETFILE). Solo accesible por admins con
 * rol "finance".
 *
 * === Endpoints ===
 *
 * POST /api/admin/tax/netfile
 *   Body: { periodo: "2026-Q2", gstCollectedCents, gstItcCents, ... }
 *   Response (XML): application/xml — archivo T619 listo para NETFILE
 *   Response (HTML): text/html — PDF/HTML para revisión del admin
 *   Response (JSON): application/json — resultado completo
 *   Query: ?format=xml → XML puro; ?format=pdf → HTML del PDF; default → JSON
 *
 * GET /api/admin/tax/netfile
 *   Query: ?periodo=2026-Q2
 *   Devuelve el estado actual del filing para ese período.
 *
 * === Auth ===
 *
 * Requiere rol "finance" vía requireAdminRole(). Sin autenticación válida
 * retorna 401; sin el rol requerido retorna 403.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { z } from "zod";
import {
  generateGstReturnXml,
  validateGstReturnXml,
  generateGstReturnPdf,
  GstReturnXmlInputSchema,
  getFilingStatus,
  type GstReturnXmlInput,
} from "@/lib/tax-netfile";

// =========================================================================
// Zod schemas para validación de requests
// =========================================================================

/** Schema for POST body — extends the tax-netfile input with periodo requirement */
const PostBodySchema = GstReturnXmlInputSchema.extend({
  periodo: z
    .string()
    .min(1, "periodo es requerido")
    .refine(
      (v) => /^\d{4}-(?:Q[1-4]|0[1-9]|1[0-2])$/.test(v),
      "periodo debe ser YYYY-QN (ej. '2026-Q2') o YYYY-MM (ej. '2026-08')",
    ),
});

const GetQuerySchema = z.object({
  periodo: z
    .string()
    .min(1, "periodo es requerido")
    .refine(
      (v) => /^\d{4}-(?:Q[1-4]|0[1-9]|1[0-2])$/.test(v),
      "periodo debe ser YYYY-QN (ej. '2026-Q2') o YYYY-MM (ej. '2026-08')",
    ),
});

// =========================================================================
// GET /api/admin/tax/netfile?periodo=2026-Q2
// =========================================================================

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", {
    method: request.method,
    url: request.url,
  });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const rawPeriodo = searchParams.get("periodo");

  const parsed = GetQuerySchema.safeParse({ periodo: rawPeriodo });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parámetro inválido", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { periodo } = parsed.data;
  const status = getFilingStatus(periodo);

  return NextResponse.json({
    periodo,
    status,
    timestamp: new Date().toISOString(),
  });
}

// =========================================================================
// POST /api/admin/tax/netfile
// =========================================================================

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────
  const auth = await requireAdminRole("finance", {
    method: request.method,
    url: request.url,
  });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!auth.supabase || !auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  // ── Parse body ──────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body debe ser JSON válido" },
      { status: 400 },
    );
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input: GstReturnXmlInput = parsed.data;

  // ── Generar XML y validar ───────────────────────────────────────────
  const xml = generateGstReturnXml(input);
  const validation = validateGstReturnXml(xml);
  const pdfHtml = generateGstReturnPdf(input);
  const filingStatus = getFilingStatus(input.periodo);

  // ── Determinar formato de respuesta ─────────────────────────────────
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "json";

  switch (format) {
    case "xml": {
      // XML puro — el admin lo descarga para revisar o cargar en portal CRA
      return new NextResponse(xml, {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="gst-return-${input.periodo}.xml"`,
        },
      });
    }

    case "pdf": {
      // HTML del GST return para revisión → imprimir a PDF desde el navegador
      return new NextResponse(pdfHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="gst-return-${input.periodo}.html"`,
        },
      });
    }

    case "json":
    default: {
      // Respuesta completa en JSON para debugging y frontend
      return NextResponse.json({
        periodo: input.periodo,
        xml,
        validation,
        pdfHtmlLength: pdfHtml.length,
        filingStatus,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
