import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { getVancouverTodayString } from "@/lib/date-utils";
import { safeErrorResponse } from "@/lib/api-errors";

const SERVICE_TYPES = ["regular", "deep", "move_in_out", "post_construction"] as const;
const RANGE_LABELS = ["≤ 700 ft²", "700 – 1,500 ft²", "1,500 – 2,500 ft²", "2,500 – 3,500 ft²", "> 3,500 ft²"];

// Fix (auditoría externa 2026-07-31): el HHE (Hours per House Estimate)
// solo se validaba como "> 0", sin techo -- un typo (ej. 500 en vez de 5.0)
// se guardaba sin aviso y multiplicaba por 100 el precio cotizado para ese
// rango de metraje. 50 horas es un techo generoso (muy por encima de
// cualquier trabajo real, que ronda 1-15h) que igual atrapa errores de
// dedo gordo de una orden de magnitud.
const MAX_HHE_VALUE = 50;

function isValidHHETable(body: unknown): body is Record<string, number[]> {
  if (!body || typeof body !== "object") return false;
  const table = body as Record<string, unknown>;
  for (const st of SERVICE_TYPES) {
    const row = table[st];
    if (!Array.isArray(row) || row.length !== 5) return false;
    if (!row.every((v) => typeof v === "number" && v > 0 && v <= MAX_HHE_VALUE)) return false;
  }
  return true;
}

export async function GET() {
  const auth = await requireAdminRole("hhe_settings");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { data, error } = await auth.supabase.rpc("get_current_hhe_table");
    if (error) {
      console.error("HHE settings fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const table: Record<string, number[]> = {
      regular: [0, 0, 0, 0, 0],
      deep: [0, 0, 0, 0, 0],
      move_in_out: [0, 0, 0, 0, 0],
      post_construction: [0, 0, 0, 0, 0],
    };

    for (const row of (data || [])) {
      const st = row.service_type as string;
      const idx = Number(row.range_index);
      const val = Number(row.hhe_value);
      if (table[st] && idx >= 0 && idx <= 4) {
        table[st][idx] = val;
      }
    }

    return NextResponse.json({ table, rangeLabels: RANGE_LABELS }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole("hhe_settings", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "hhe_settings", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  try {
    const body = await request.json();
    const { table, reason } = body;

    if (!isValidHHETable(table)) {
      return NextResponse.json(
        {
          error: `Invalid HHE table. Must include 4 service types with 5 numbers each, all > 0 and <= ${MAX_HHE_VALUE}.`,
        },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason is required for audit log" }, { status: 400 });
    }

    const today = getVancouverTodayString();

    // Fix (auditoría de integridad de datos 2026-08-01): antes esto hacía
    // ~20 escrituras sueltas (4 tipos × 5 rangos × [UPDATE cierre + INSERT])
    // desde el cliente JS sin ninguna transacción -- si una fallaba a
    // mitad de camino, las anteriores ya habían committeado y la tabla
    // quedaba en un estado mixto. Ahora es una sola llamada RPC
    // (migración 304) que hace las 20 celdas dentro de una función plpgsql
    // atómica: o todas committean, o ninguna.
    const { error: rpcError } = await auth.supabase.rpc("admin_update_hhe_table", {
      p_table: table,
      p_reason: reason.trim(),
      p_admin_id: auth.user.id,
      p_effective_date: today,
    });

    if (rpcError) {
      console.error("HHE setting update error:", rpcError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json(
      {
        table,
        message: "HHE table updated successfully.",
        changedBy: auth.user.id,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}
