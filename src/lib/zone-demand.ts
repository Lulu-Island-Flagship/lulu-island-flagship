/**
 * Reemplaza el placeholder `zoneDemand: 50` fijo que usaban las 4 rutas de
 * cotización (quote/route.ts, quote/preview/route.ts, quote/recalculate/
 * route.ts, admin/phone-booking/route.ts) desde v8.3. `zoneDemand` (0-100,
 * ver src/lib/rules.ts) es un input del motor de reglas de precio para
 * ajustar tarifa por demanda de la zona -- antes siempre calculaba sobre 50
 * sin importar la ocupación real.
 *
 * Fuente de verdad: capacity_slots (migración 026) -- max_teams/
 * committed_teams por (service_date, zone). La demanda de una zona se define
 * como qué tan comprometida está su capacidad: committed/max, escalado a
 * 0-100.
 *
 * Con fecha de servicio ya elegida (recalculate, checkout con fecha
 * confirmada): se usa la ocupación de ESE día específico.
 *
 * Sin fecha todavía (cotización inicial, antes de que el cliente elija
 * fecha -- ver comentario "advanceNoticeDays: 0" en quote/route.ts): no hay
 * un día contra el cual calcular, así que se usa un promedio de ocupación de
 * los próximos 14 días publicados para esa zona, como proxy de "qué tan
 * ocupada anda la zona en general ahora mismo".
 *
 * Si no hay ninguna fila de capacity_slots (zona sin capacidad configurada
 * todavía, o ambiente de staging/dev sin seed), se devuelve 50 -- el punto
 * medio de la escala 0-100, que es la lectura correcta de "sin señal todavía"
 * para este campo en particular (a diferencia de employerBurdenCents o
 * zoneDemand en otros contextos, aquí 50 no es un número inventado: es el
 * valor neutral documentado de la escala cuando no hay datos de ocupación).
 */

export interface CapacitySlotAggregate {
  maxTeams: number;
  committedTeams: number;
}

/** Función pura y testeable: agrega slots a un score 0-100. */
export function computeZoneDemandScore(slots: CapacitySlotAggregate[]): number {
  const totals = slots.reduce(
    (acc, s) => ({
      maxTeams: acc.maxTeams + Math.max(0, s.maxTeams),
      committedTeams: acc.committedTeams + Math.max(0, s.committedTeams),
    }),
    { maxTeams: 0, committedTeams: 0 }
  );

  if (totals.maxTeams <= 0) {
    return 50; // sin capacidad configurada para agregar -- neutral, no inventado.
  }

  const utilization = totals.committedTeams / totals.maxTeams;
  return Math.max(0, Math.min(100, Math.round(utilization * 100)));
}

/**
 * Consulta capacity_slots y devuelve el score 0-100. `serviceDate` en
 * formato YYYY-MM-DD; si es null, usa la ventana rolling de 14 días desde
 * hoy (America/Vancouver ya se maneja aguas arriba en el caller -- esta
 * función solo recibe strings YYYY-MM-DD ya resueltos).
 *
 * `supabase` se tipa laxo a propósito (SupabaseClient real tiene un tipo de
 * query builder muy amplio y encadenado que no vale la pena replicar aquí
 * solo para esta consulta secundaria de solo-lectura).
 */
export async function getZoneDemand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  zone: string,
  serviceDate: string | null
): Promise<number> {
  try {
    if (serviceDate) {
      const { data, error } = await supabase
        .from("capacity_slots")
        .select("max_teams, committed_teams")
        .eq("zone", zone)
        .eq("service_date", serviceDate);
      if (error || !data) return 50;
      return computeZoneDemandScore(
        (data as { max_teams: number; committed_teams: number }[]).map((r) => ({
          maxTeams: r.max_teams,
          committedTeams: r.committed_teams,
        }))
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + 13);
    const windowEndStr = windowEnd.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("capacity_slots")
      .select("max_teams, committed_teams")
      .eq("zone", zone)
      .gte("service_date", today)
      .lte("service_date", windowEndStr);
    if (error || !data) return 50;
    return computeZoneDemandScore(
      (data as { max_teams: number; committed_teams: number }[]).map((r) => ({
        maxTeams: r.max_teams,
        committedTeams: r.committed_teams,
      }))
    );
  } catch {
    // Cualquier fallo de red/DB -- degrada al valor neutral, nunca rompe la
    // cotización por un problema de disponibilidad de este dato secundario.
    return 50;
  }
}
