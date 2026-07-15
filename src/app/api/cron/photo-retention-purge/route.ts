import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decideOrderPhotoPurge, type OrderClaimStatus } from "@/lib/photo-retention";

/**
 * POST /api/cron/photo-retention-purge — v8.3 E9.12 "Retención de fotos"
 *
 * "Disputas 2 años, QC 1 año." Recorre las fotos de checklist
 * (service_checklist_items.photo_url) y de evidencia de reclamos
 * (warranty_photo_evidence.photo_url), decide con decideOrderPhotoPurge
 * (src/lib/photo-retention.ts) si ya venció su ventana de retención, y si
 * sí: borra el objeto en Supabase Storage, pone photo_url = NULL, y deja
 * un rastro inmutable en photo_retention_deletions (migración 165).
 *
 * Invariante duro (heredado de la lógica pura): un reclamo sin resolver
 * NUNCA se purga, sin importar la edad. Este cron confía completamente en
 * decideOrderPhotoPurge para esa decisión -- nunca la reimplementa aquí.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

const PHOTO_BUCKET = "service-photos";

/** Extrae el path dentro del bucket a partir de una URL pública de Supabase Storage. */
function extractStoragePath(publicUrl: string): string | null {
  const marker = `/object/public/${PHOTO_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const bearer = authHeader?.replace("Bearer ", "");
  if (bearer !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const today = new Date().toISOString();

  let checklistPurged = 0;
  let evidencePurged = 0;
  const errors: string[] = [];

  try {
    // ------------------------------------------------------------------
    // 1. Fotos de checklist (service_checklist_items.photo_url)
    // ------------------------------------------------------------------
    const { data: checklistPhotos, error: checklistError } = await supabase
      .from("service_checklist_items")
      .select("id, order_id, photo_url")
      .not("photo_url", "is", null);
    if (checklistError) throw checklistError;

    // Agrupar por order_id para no repetir la consulta de reclamos por foto.
    const orderIds = Array.from(new Set((checklistPhotos || []).map((p) => p.order_id)));
    const claimStatusByOrder = new Map<string, OrderClaimStatus>();
    const serviceDateByOrder = new Map<string, string>();

    if (orderIds.length > 0) {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, service_date")
        .in("id", orderIds);
      for (const o of orders || []) {
        serviceDateByOrder.set(o.id, o.service_date);
      }

      const { data: claims } = await supabase
        .from("warranty_claims")
        .select("order_id, status, resolved_at")
        .in("order_id", orderIds);
      const claimsByOrder = new Map<string, { status: string; resolved_at: string | null }[]>();
      for (const c of claims || []) {
        const list = claimsByOrder.get(c.order_id) || [];
        list.push({ status: c.status, resolved_at: c.resolved_at });
        claimsByOrder.set(c.order_id, list);
      }
      for (const orderId of orderIds) {
        const claimsForOrder = claimsByOrder.get(orderId) || [];
        const hasAnyClaim = claimsForOrder.length > 0;
        const hasUnresolvedClaim = claimsForOrder.some((c) => c.status === "open" || c.status === "escalated");
        const resolvedDates = claimsForOrder
          .map((c) => c.resolved_at)
          .filter((d): d is string => Boolean(d))
          .sort();
        const latestResolvedAtISO = resolvedDates.length > 0 ? resolvedDates[resolvedDates.length - 1] : null;
        claimStatusByOrder.set(orderId, { hasAnyClaim, hasUnresolvedClaim, latestResolvedAtISO });
      }
    }

    for (const photo of checklistPhotos || []) {
      const serviceDate = serviceDateByOrder.get(photo.order_id);
      if (!serviceDate) continue;
      const claimStatus = claimStatusByOrder.get(photo.order_id) || {
        hasAnyClaim: false,
        hasUnresolvedClaim: false,
        latestResolvedAtISO: null,
      };
      const decision = decideOrderPhotoPurge(serviceDate, claimStatus, today);
      if (!decision.eligible || !photo.photo_url) continue;

      const storagePath = extractStoragePath(photo.photo_url);
      let storageDeleteSucceeded = true;
      let storageDeleteError: string | null = null;
      if (storagePath) {
        const { error: removeError } = await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
        if (removeError) {
          storageDeleteSucceeded = false;
          storageDeleteError = removeError.message;
          errors.push(`checklist item ${photo.id}: ${removeError.message}`);
        }
      } else {
        storageDeleteSucceeded = false;
        storageDeleteError = "could_not_parse_storage_path";
      }

      // Sin importar si el borrado en Storage tuvo éxito, se nulifica la
      // referencia y se deja el rastro -- una URL rota no debe seguir
      // sirviéndose de todos modos, y el registro de auditoría documenta el
      // intento incluso si el archivo físico no pudo localizarse.
      await supabase.from("service_checklist_items").update({ photo_url: null }).eq("id", photo.id);
      await supabase.from("photo_retention_deletions").insert({
        source_table: "service_checklist_items",
        source_row_id: photo.id,
        order_id: photo.order_id,
        photo_url: photo.photo_url,
        category: decision.category,
        storage_delete_succeeded: storageDeleteSucceeded,
        storage_delete_error: storageDeleteError,
      });
      checklistPurged++;
    }

    // ------------------------------------------------------------------
    // 2. Fotos de evidencia de reclamos (warranty_photo_evidence.photo_url)
    //    -- estas SIEMPRE son categoría "dispute" (son evidencia de un
    //    reclamo, sin importar si el reclamo del checklist original tenía
    //    otras fotos "qc"). Un reclamo sin resolver bloquea la purga.
    // ------------------------------------------------------------------
    const { data: evidenceRows, error: evidenceError } = await supabase
      .from("warranty_photo_evidence")
      .select("id, warranty_claim_id, photo_url")
      .not("photo_url", "is", null);
    if (evidenceError) throw evidenceError;

    const claimIds = Array.from(new Set((evidenceRows || []).map((e) => e.warranty_claim_id)));
    const claimById = new Map<string, { order_id: string; status: string; resolved_at: string | null }>();
    if (claimIds.length > 0) {
      const { data: claimRows } = await supabase
        .from("warranty_claims")
        .select("id, order_id, status, resolved_at")
        .in("id", claimIds);
      for (const c of claimRows || []) {
        claimById.set(c.id, { order_id: c.order_id, status: c.status, resolved_at: c.resolved_at });
      }
    }

    for (const evidence of evidenceRows || []) {
      const claim = claimById.get(evidence.warranty_claim_id);
      if (!claim) continue;
      const isUnresolved = claim.status === "open" || claim.status === "escalated";
      const claimStatus: OrderClaimStatus = {
        hasAnyClaim: true,
        hasUnresolvedClaim: isUnresolved,
        latestResolvedAtISO: claim.resolved_at,
      };
      // serviceDateISO no aplica aquí (siempre irá por la rama "dispute"
      // dentro de decideOrderPhotoPurge dado hasAnyClaim=true); se pasa un
      // valor cualquiera porque esa rama nunca lo usa cuando hasAnyClaim.
      const decision = decideOrderPhotoPurge(today, claimStatus, today);
      if (!decision.eligible || !evidence.photo_url) continue;

      const storagePath = extractStoragePath(evidence.photo_url);
      let storageDeleteSucceeded = true;
      let storageDeleteError: string | null = null;
      if (storagePath) {
        const { error: removeError } = await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
        if (removeError) {
          storageDeleteSucceeded = false;
          storageDeleteError = removeError.message;
          errors.push(`warranty evidence ${evidence.id}: ${removeError.message}`);
        }
      } else {
        storageDeleteSucceeded = false;
        storageDeleteError = "could_not_parse_storage_path";
      }

      await supabase.from("warranty_photo_evidence").update({ photo_url: null }).eq("id", evidence.id);
      await supabase.from("photo_retention_deletions").insert({
        source_table: "warranty_photo_evidence",
        source_row_id: evidence.id,
        order_id: claim.order_id,
        photo_url: evidence.photo_url,
        category: "dispute",
        storage_delete_succeeded: storageDeleteSucceeded,
        storage_delete_error: storageDeleteError,
      });
      evidencePurged++;
    }

    return NextResponse.json(
      { checklistPurged, evidencePurged, errors: errors.length > 0 ? errors : undefined },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
