/**
 * v8.3 E4 (D.7) — Zonas add-on (ej. Garaje) editables por el admin,
 * propagadas a cotización. Único punto de lectura de sop_checklists para
 * is_addon_zone=true, usado por los 3 endpoints de cotización (preview,
 * quote, recalculate) para que el servidor SIEMPRE recalcule el recargo
 * contra la lista real — nunca confía en un monto que venga del cliente.
 */

import type { AddonZoneOption } from "./pricing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export async function fetchAddonZoneOptions(
  supabase: SupabaseClient,
  serviceSubtype: string
): Promise<AddonZoneOption[]> {
  const { data } = await supabase
    .from("sop_checklists")
    .select("zone, zone_label, zone_time_hours")
    .is("deleted_at", null)
    .eq("service_subtype", serviceSubtype)
    .eq("is_active", true)
    .eq("is_addon_zone", true);

  return (data || []).map((row: { zone: string; zone_label: string; zone_time_hours: number }) => ({
    zone: row.zone,
    zoneLabel: row.zone_label,
    timeHours: Number(row.zone_time_hours) || 0,
  }));
}
