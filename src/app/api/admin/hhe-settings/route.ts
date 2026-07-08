import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

const SERVICE_TYPES = ["regular", "deep", "move_in_out", "post_construction"] as const;
const RANGE_LABELS = ["≤ 700 ft²", "700 – 1,500 ft²", "1,500 – 2,500 ft²", "2,500 – 3,500 ft²", "> 3,500 ft²"];

function isValidHHETable(body: unknown): body is Record<string, number[]> {
  if (!body || typeof body !== "object") return false;
  const table = body as Record<string, unknown>;
  for (const st of SERVICE_TYPES) {
    const row = table[st];
    if (!Array.isArray(row) || row.length !== 5) return false;
    if (!row.every((v) => typeof v === "number" && v > 0)) return false;
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
      return NextResponse.json({ error: error.message }, { status: 500 });
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
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole("hhe_settings", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { table, reason } = body;

    if (!isValidHHETable(table)) {
      return NextResponse.json(
        { error: "Invalid HHE table. Must include 4 service types with 5 positive numbers each." },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason is required for audit log" }, { status: 400 });
    }

    const today = new Date().toISOString().split("T")[0];

    // Cerrar filas vigentes previas e insertar nuevas en una transacción
    for (const st of SERVICE_TYPES) {
      for (let idx = 0; idx < 5; idx++) {
        const value = table[st][idx];

        await auth.supabase
          .from("hhe_settings")
          .update({ effective_to: today, updated_at: new Date().toISOString() })
          .eq("service_type", st)
          .eq("range_index", idx)
          .is("effective_to", null);

        const { error: insertError } = await auth.supabase.from("hhe_settings").insert({
          service_type: st,
          range_index: idx,
          hhe_value: value,
          effective_from: today,
          reason: reason.trim(),
          created_by: auth.user.id,
        });

        if (insertError) {
          console.error("HHE setting insert error:", insertError);
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }
      }
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
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
