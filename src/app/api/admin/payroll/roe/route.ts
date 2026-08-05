import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

import {
  prepareRoe,
  getPendingRoes,
  getSubmissionDeadline,
  type RoeSubmissionResult,
} from "@/lib/roe-submission";
import {
  getTerminationTypes,
  generateRoePreview,
  type RoeTerminationCode,
  ROE_TERMINATION_DESCRIPTIONS,
} from "@/lib/roe-generator";

// =========================================================================
// POST /api/admin/payroll/roe
// =========================================================================

/**
 * Genera un Record of Employment (ROE) para un empleado terminado.
 *
 * Body (JSON):
 *   - empleado_id: string (UUID del empleado)
 *   - motivo: string (código Service Canada: A, E, K, M, N, …)
 *   - ultimo_dia?: string (YYYY-MM-DD, último día trabajado; default: terminated_at)
 *   - comentarios?: string (comentarios opcionales, Block 18)
 *
 * Respuesta 200:
 *   - roe: RecordOfEmployment (53 boxes, SIN enmascarado)
 *   - xml: string (XML para Service Canada ROE Web)
 *   - preview: string (vista previa human-readable)
 *   - validation: { valid, errors, warnings }
 *   - contentHash: string (SHA-256 del XML)
 *   - serialNumber: string
 *
 * Autenticación: solo admin (owner_admin con recurso "payroll").
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("payroll", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || "Unauthorized" },
      { status: auth.status || 401 },
    );
  }

  // ── Validar input ──────────────────────────────────────────────────────
  let body: {
    empleado_id?: unknown;
    motivo?: unknown;
    ultimo_dia?: unknown;
    comentarios?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  // empleado_id
  if (typeof body.empleado_id !== "string" || !body.empleado_id.trim()) {
    return NextResponse.json(
      { error: "empleado_id (UUID) es requerido" },
      { status: 400 },
    );
  }
  const empleadoId = body.empleado_id.trim();

  // motivo
  const validCodes = Object.keys(ROE_TERMINATION_DESCRIPTIONS);
  if (
    typeof body.motivo !== "string" ||
    !validCodes.includes(body.motivo.toUpperCase())
  ) {
    return NextResponse.json(
      {
        error: `motivo debe ser un código de terminación Service Canada válido: ${validCodes.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const motivo = body.motivo.toUpperCase() as RoeTerminationCode;

  // ultimo_dia (opcional)
  const ultimoDia =
    typeof body.ultimo_dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.ultimo_dia)
      ? body.ultimo_dia
      : undefined;

  // comentarios (opcional)
  const comentarios =
    typeof body.comentarios === "string" && body.comentarios.trim()
      ? body.comentarios.trim()
      : undefined;

  // ── Obtener cliente service_role ───────────────────────────────────────
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Server configuration error — service role not available" },
      { status: 500 },
    );
  }

  // ── Generar ROE ────────────────────────────────────────────────────────
  try {
    const result: RoeSubmissionResult = await prepareRoe(
      serviceClient,
      empleadoId,
      motivo,
      ultimoDia,
      comentarios,
    );

    // Generar preview (puro, SIN enmascarado)
    const preview = generateRoePreview(empleadoId, motivo ?? "A");

    return NextResponse.json(
      {
        roe: {
          ...result.roe,
          // El SIN en el ROE de respuesta ya está enmascarado
        },
        xml: result.xml,
        preview,
        validation: result.validation,
        contentHash: result.contentHash,
        serialNumber: result.serialNumber,
        generatedAt: result.generatedAt,
      },
      { status: 200 },
    );
  } catch (err) {
    // El error ya fue logueado en prepareRoe() con SIN enmascarado
    return safeErrorResponse(err, 500, "Error al generar el ROE");
  }
}

// =========================================================================
// GET /api/admin/payroll/roe
// =========================================================================

/**
 * Obtiene información sobre ROEs.
 *
 * Query params:
 *   - action=pending  → lista de empleados terminados sin ROE
 *   - action=deadline → fecha límite para un empleado
 *     (requiere empleado_id y opcional fin_periodo_pago)
 *   - action=codes    → lista de códigos de terminación Service Canada
 *
 * Sin query params: devuelve los códigos de terminación disponibles.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("payroll", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || "Unauthorized" },
      { status: auth.status || 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  // ── action=codes (o sin action) ────────────────────────────────────────
  if (!action || action === "codes") {
    const types = getTerminationTypes();
    return NextResponse.json({ terminationTypes: types }, { status: 200 });
  }

  // ── action=pending ─────────────────────────────────────────────────────
  if (action === "pending") {
    const serviceClient = getServiceRoleClient();
    if (!serviceClient) {
      return NextResponse.json(
        { error: "Server configuration error — service role not available" },
        { status: 500 },
      );
    }

    try {
      const pending = await getPendingRoes(serviceClient);
      return NextResponse.json({ pending }, { status: 200 });
    } catch (err) {
      return safeErrorResponse(err, 500, "Error al obtener ROEs pendientes");
    }
  }

  // ── action=deadline ────────────────────────────────────────────────────
  if (action === "deadline") {
    const empleadoId = searchParams.get("empleado_id");
    if (!empleadoId) {
      return NextResponse.json(
        { error: "empleado_id query param es requerido para action=deadline" },
        { status: 400 },
      );
    }

    const serviceClient = getServiceRoleClient();
    if (!serviceClient) {
      return NextResponse.json(
        { error: "Server configuration error — service role not available" },
        { status: 500 },
      );
    }

    try {
      // Obtener fecha de terminación del empleado
      const { data: employee, error: empError } = await serviceClient
        .from("employees")
        .select("terminated_at")
        .eq("id", empleadoId)
        .single();

      if (empError || !employee?.terminated_at) {
        return NextResponse.json(
          { error: "Empleado no encontrado o no terminado" },
          { status: 404 },
        );
      }

      const terminationDate = (employee.terminated_at as string).slice(0, 10);
      const finPeriodoPago = searchParams.get("fin_periodo_pago") ?? undefined;

      const deadline = getSubmissionDeadline(terminationDate, finPeriodoPago);

      return NextResponse.json(
        {
          empleado_id: empleadoId,
          termination_date: terminationDate,
          deadline,
          days_remaining: Math.max(
            0,
            Math.ceil(
              (new Date(deadline + "T23:59:59-08:00").getTime() -
                Date.now()) /
                (1000 * 60 * 60 * 24),
            ),
          ),
        },
        { status: 200 },
      );
    } catch (err) {
      return safeErrorResponse(err, 500, "Error al calcular deadline");
    }
  }

  return NextResponse.json(
    { error: `action "${action}" desconocida. Usar: codes, pending, deadline` },
    { status: 400 },
  );
}
