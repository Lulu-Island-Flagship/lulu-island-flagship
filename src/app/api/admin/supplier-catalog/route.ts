import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";
import { getVancouverTodayString } from "@/lib/date-utils";

// GET /api/admin/supplier-catalog — catálogo proveedor x producto con precio
// histórico (v8.3 E7 punto 6). Por defecto solo trae los precios vigentes
// (is_current = true); ?all=1 trae también el histórico.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("inventory", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includeAll = request.nextUrl.searchParams.get("all") === "1";
  const inventoryItemId = request.nextUrl.searchParams.get("inventoryItemId");
  const supplierId = request.nextUrl.searchParams.get("supplierId");

  let query = supabase
    .from("supplier_catalog")
    .select(`
      id, supplier_id, inventory_item_id, unit_price_cents, currency, effective_from, is_current, created_at,
      suppliers ( id, name, lead_time_days ),
      inventory_items ( id, name, unit )
    `)
    .order("effective_from", { ascending: false });

  if (!includeAll) {
    query = query.eq("is_current", true);
  }
  if (inventoryItemId) {
    query = query.eq("inventory_item_id", inventoryItemId);
  }
  if (supplierId) {
    query = query.eq("supplier_id", supplierId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("admin/supplier-catalog error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ catalog: data || [] }, { status: 200 });
}

// POST /api/admin/supplier-catalog — registrar un nuevo precio vigente para
// una combinación proveedor+producto. El precio anterior (si existe) se
// marca is_current = false para mantener el historial, y el nuevo entra como
// vigente — así las POs siempre pueden leer el precio actual sin ambigüedad
// (índice único parcial en la migración 048 garantiza un solo "vigente" por
// combinación).
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("inventory", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { supplierId, inventoryItemId, unitPriceCents, currency, effectiveFrom } = body;

    if (!supplierId || !inventoryItemId || unitPriceCents === undefined || unitPriceCents === null) {
      return NextResponse.json(
        { error: "supplierId, inventoryItemId y unitPriceCents son requeridos" },
        { status: 400 }
      );
    }

    const priceCents = Math.round(Number(unitPriceCents));
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      return NextResponse.json({ error: "unitPriceCents debe ser un número >= 0" }, { status: 400 });
    }

    // ─── Compensating Transaction Pattern ─────────────────────────────────────
    // ⚠ RACE WINDOW: This handler retires the old is_current row before
    // inserting the new one. Between the retire UPDATE and the INSERT, a
    // process crash or network partition leaves the (supplier, inventory_item)
    // pair with NO is_current=true row → PO generation breaks because it reads
    // is_current=true. The compensate-on-failure logic below mitigates the
    // common failure case (insert rejection), but cannot help a hard crash.
    //
    // Only an atomic RPC function (single DB transaction: retire old + insert
    // new) can fully close this window. Until then, if the CRITICAL restore
    // log fires, an admin must manually set is_current=true on the most recent
    // historical row for the affected pair.
    // ───────────────────────────────────────────────────────────────────────────

    // Step 0: Snapshot the current row so we can restore by exact id on failure.
    const { data: oldRow, error: fetchError } = await supabase
      .from("supplier_catalog")
      .select("id, supplier_id, inventory_item_id, unit_price_cents, currency, effective_from, is_current, created_at")
      .eq("supplier_id", supplierId)
      .eq("inventory_item_id", inventoryItemId)
      .eq("is_current", true)
      .maybeSingle();

    if (fetchError) {
      console.error("admin/supplier-catalog fetch error:", fetchError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // Step 1: Retire (if a current row exists).
    if (oldRow) {
      const { error: retireError } = await supabase
        .from("supplier_catalog")
        .update({ is_current: false })
        .eq("id", oldRow.id);

      if (retireError) {
        console.error("admin/supplier-catalog retire error:", retireError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
    }

    // Step 2: Insert the new current row.
    // TODO: Replace with atomic RPC function (single transaction: retire old +
    // insert new). See migration pattern in pricing-settings for reference.
    const { data: newRow, error: insertError } = await supabase
      .from("supplier_catalog")
      .insert({
        supplier_id: supplierId,
        inventory_item_id: inventoryItemId,
        unit_price_cents: priceCents,
        currency: currency || "CAD",
        effective_from: effectiveFrom || getVancouverTodayString(),
        is_current: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error("admin/supplier-catalog insert error:", insertError);

      // Step 3: Compensate — restore the old row's is_current=true by exact id.
      if (oldRow) {
        try {
          const { error: restoreError } = await supabase
            .from("supplier_catalog")
            .update({ is_current: true })
            .eq("id", oldRow.id);

          if (restoreError) {
            console.error(
              "CRITICAL: Failed to restore is_current after insert failure. " +
                `supplier_id=${supplierId}, inventory_item_id=${inventoryItemId}, ` +
                `old_row_id=${oldRow.id}. Manual fix required. Restore error:`,
              restoreError
            );
          }
        } catch (restoreErr) {
          console.error(
            "CRITICAL: Exception during is_current restore after insert failure. " +
              `supplier_id=${supplierId}, inventory_item_id=${inventoryItemId}, ` +
              `old_row_id=${oldRow.id}. Manual fix required.`,
            restoreErr
          );
        }
      }

      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ catalogEntry: newRow }, { status: 201 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}
