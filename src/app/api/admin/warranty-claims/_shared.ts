/**
 * v8.3 E5 (Sesión Q) — helper compartido con I/O (Supabase) para las rutas
 * de warranty-claims. No es una route.ts (Next.js la ignora como endpoint),
 * solo evita duplicar el armado de `zones` / `claim` entre el GET de detalle
 * y el POST de resolución. La lógica de negocio en sí vive en
 * src/lib/warranty-dispute-resolution.ts (función pura, sin I/O).
 */
import {
  evaluateWarrantyDisputeResolution,
  type ZoneClosureEvidence,
  type ClientClaimInput,
  type WarrantyDisputeResolutionResult,
} from "@/lib/warranty-dispute-resolution";

interface ChecklistItemRow {
  photo_url: string | null;
  sop_checklists: { zone: string; zone_label: string } | { zone: string; zone_label: string }[] | null;
}

interface ClaimRow {
  id: string;
  order_id: string;
  claim_zone: string | null;
  reason: string;
  status: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadDisputeResolutionContext(supabase: any, claimId: string) {
  const { data: claim, error: claimError } = await supabase
    .from("warranty_claims")
    .select("id, order_id, claim_zone, reason, status")
    .eq("id", claimId)
    .maybeSingle();

  if (claimError) {
    console.error("admin/warranty-claims/_shared claim fetch error:", claimError);
    return { error: "Ocurrió un error interno", status: 500 as const };
  }
  if (!claim) {
    return { error: "Warranty claim not found", status: 404 as const };
  }

  const claimRow = claim as ClaimRow;

  if (!claimRow.claim_zone) {
    return {
      error:
        "El reclamo no tiene 'claim_zone' asignada: no se puede comparar contra la foto de cierre de una zona específica.",
      status: 400 as const,
    };
  }

  const [{ data: checklistItems, error: checklistError }, { data: clientEvidence, error: evidenceError }] =
    await Promise.all([
      supabase
        .from("service_checklist_items")
        .select("photo_url, sop_checklists(zone, zone_label)")
        .eq("order_id", claimRow.order_id),
      supabase
        .from("warranty_photo_evidence")
        .select("id, photo_url, zone, item_label")
        .eq("warranty_claim_id", claimId)
        .eq("photo_type", "client"),
    ]);

  if (checklistError) {
    console.error("admin/warranty-claims/_shared checklist fetch error:", checklistError);
    return { error: "Ocurrió un error interno", status: 500 as const };
  }
  if (evidenceError) {
    console.error("admin/warranty-claims/_shared evidence fetch error:", evidenceError);
    return { error: "Ocurrió un error interno", status: 500 as const };
  }

  const zoneMap = new Map<string, ZoneClosureEvidence>();
  for (const row of (checklistItems as ChecklistItemRow[]) || []) {
    const sop = Array.isArray(row.sop_checklists) ? row.sop_checklists[0] : row.sop_checklists;
    if (!sop?.zone) continue;
    const existing = zoneMap.get(sop.zone) ?? {
      zone: sop.zone,
      zoneLabel: sop.zone_label,
      hasClosurePhoto: false,
      closurePhotoUrls: [],
    };
    if (row.photo_url) {
      existing.hasClosurePhoto = true;
      existing.closurePhotoUrls.push(row.photo_url);
    }
    zoneMap.set(sop.zone, existing);
  }
  const zones: ZoneClosureEvidence[] = Array.from(zoneMap.values());

  const clientPhotoUrls: string[] = (clientEvidence || []).map(
    (e: { photo_url: string }) => e.photo_url
  );

  const claimInput: ClientClaimInput = {
    claimZone: claimRow.claim_zone,
    claimReason: claimRow.reason,
    hasClientEvidence: clientPhotoUrls.length > 0,
    clientEvidencePhotoUrls: clientPhotoUrls,
  };

  const decision: WarrantyDisputeResolutionResult = evaluateWarrantyDisputeResolution(zones, claimInput);

  return {
    claim: claimRow,
    zones,
    claimInput,
    clientEvidence: clientEvidence || [],
    decision,
    status: 200 as const,
  };
}
