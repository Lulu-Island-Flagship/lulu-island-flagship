/**
 * POST /api/admin/export/accounting — Endpoint unificado de exportación contable.
 *
 * Capa 9 — Accounting Adapter: descarga de asientos contables en formato
 * CSV, IIF (QuickBooks), PDF (HTML print-ready con P&L + Balance + Cash Flow),
 * o JSON (datos crudos del shadow ledger).
 *
 * Autenticación: solo admin (owner_admin, ops_coordinator).
 * Rate limit: máximo 1 exportación por minuto por admin.
 *
 * Body esperado:
 * ```json
 * {
 *   "periodo": "2026-08",           // o "2026-01..2026-06" para rango
 *   "format": "csv" | "iif" | "pdf" | "json"
 * }
 * ```
 *
 * Respuestas:
 * - 200: archivo descargable con Content-Type y Content-Disposition.
 * - 400: body inválido o período mal formado.
 * - 401: no autenticado.
 * - 403: sin permiso de finanzas (requiere owner_admin).
 * - 429: rate limit excedido (esperar N segundos).
 * - 500: error interno.
 *
 * @module admin/export/accounting
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient } from "@/lib/admin";
import {
  handleExportRequest,
  logExportAudit,
  isExportRateLimited,
  ExportRequestSchema,
} from "@/lib/export-service";

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Autenticación + RBAC (solo owner_admin u ops_coordinator)
  const auth = await requireAdminRole("finance", {
    method: request.method,
    url: request.url,
  });

  if (auth.error) {
    return NextResponse.json(
      { error: auth.error, code: (auth as { code?: string }).code },
      { status: auth.status }
    );
  }

  const { supabase, user } = auth;
  if (!supabase || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // 2. Rate limit: máximo 1 export por minuto por admin
  const { limited, retryAfterSecs } = await isExportRateLimited(
    supabase,
    user.id
  );

  if (limited) {
    return NextResponse.json(
      {
        error: `Rate limit excedido. Reintente en ${retryAfterSecs} segundos.`,
        code: "RATE_LIMITED",
        retryAfterSecs,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSecs),
        },
      }
    );
  }

  // 3. Parsear y validar el body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body JSON inválido", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = ExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Body inválido",
        code: "INVALID_REQUEST",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  // 4. Orquestar la exportación
  //
  // shadow_ledger_entries tiene RLS restrictiva (solo supervisors pueden leer).
  // Usamos el service role client aquí porque requireAdminRole ya verificó
  // RBAC (owner_admin) — mismo patrón documentado en src/lib/admin.ts.
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Service role no configurado", code: "SERVICE_ROLE_MISSING" },
      { status: 500 }
    );
  }

  const result = await handleExportRequest(serviceClient, parsed.data);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status }
    );
  }

  // 5. Auditar la exportación exitosa (best-effort, no bloquea la descarga)
  logExportAudit(
    supabase,
    result.periodLabel,
    parsed.data.format,
    user.id
  ).catch((err) => {
    console.error("admin/export/accounting: audit log async failed", err);
  });

  // 6. Devolver el archivo con los headers correctos
  const headers: Record<string, string> = {
    "Content-Type": result.contentType,
    "Content-Disposition": `attachment; filename="${result.fileName}"`,
    "Cache-Control": "no-store, max-age=0",
  };

  // CSV e IIF llevan BOM para Excel en Windows
  if (parsed.data.format === "csv" || parsed.data.format === "iif") {
    return new NextResponse(`\uFEFF${result.content}`, {
      status: 200,
      headers,
    });
  }

  return new NextResponse(result.content, {
    status: 200,
    headers,
  });
}

// ---------------------------------------------------------------------------
// Métodos no soportados
// ---------------------------------------------------------------------------

/**
 * GET no está soportado en este endpoint.
 * Para historial de exportaciones, usar el panel de auditoría en el UI.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: "Método no soportado. Use POST con body {periodo, format}.",
      code: "METHOD_NOT_ALLOWED",
    },
    { status: 405 }
  );
}

/**
 * PUT / PATCH / DELETE no están soportados.
 */
export async function PUT() {
  return NextResponse.json(
    { error: "Método no soportado", code: "METHOD_NOT_ALLOWED" },
    { status: 405 }
  );
}
