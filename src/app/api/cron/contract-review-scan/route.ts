import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isContractReviewDue,
  wasReviewAlreadyTriggeredForAnniversary,
  summarizeLegalChangesForReview,
} from "@/lib/contract-review";
import { getVancouverTodayString } from "@/lib/date-utils";

/**
 * POST /api/cron/contract-review-scan — v8.3 E9.8.
 *
 * Diario: para cada contrato recurrente activo, si hoy cae DENTRO de la
 * ventana de 60 días antes de su próximo aniversario (rango, no igualdad
 * exacta -- fix de auditoría, ver src/lib/contract-review.ts
 * isContractReviewDue), junta los legal_change_alerts detectados desde la
 * última revisión (o desde el inicio del contrato si nunca hubo una) y
 * crea una fila pendiente en contract_reviews para que el admin decida si
 * aplican y arme la versión actualizada. Nunca aprueba ni firma solo.
 * `review_triggered_for_anniversary` (migración 187) evita que el cron
 * reintente la misma revisión cada uno de los 60 días de la ventana.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (authHeader?.replace("Bearer ", "") !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // v8.3 fix (auditoría 2026-07-15): usaba new Date().toISOString() (UTC)
    // en vez del helper de zona horaria Vancouver que sí usan los demás
    // crons fecha-sensibles (p.ej. contract-ipc-adjustment). Funcionaba sin
    // fallo visible hoy porque el cron corre a las 9:00 UTC (madrugada
    // Vancouver, misma fecha en ambas zonas), pero es frágil: si el horario
    // en vercel.json cambia a correr más tarde en el día, la ventana de
    // "60 días antes del aniversario" empieza a calcularse con un día de
    // desface respecto a la intención documentada ("mismo hito, hora
    // Vancouver").
    const todayISO = getVancouverTodayString();

    const { data: contracts, error: contractsError } = await supabase
      .from("service_contracts")
      .select("id, start_date, frequency, base_price, total, service_subtype, review_triggered_for_anniversary")
      .eq("status", "active");
    if (contractsError) return NextResponse.json({ error: contractsError.message }, { status: 500 });

    const { data: allAlerts } = await supabase
      .from("legal_change_alerts")
      .select("id, change_description, detected_at")
      .is("deleted_at", null)
      .order("detected_at", { ascending: true });

    let reviewsCreated = 0;
    const results: { contractId: string; created: boolean }[] = [];

    for (const contract of contracts || []) {
      if (!isContractReviewDue(contract.start_date, todayISO)) continue;
      // Bug real de auditoría: isContractReviewDue ahora es un RANGO de 60
      // días (antes era `===` de un único día), así que sin esta guarda el
      // cron reintentaría crear la misma revisión los 60 días de la
      // ventana. `review_triggered_for_anniversary` recuerda para qué
      // aniversario ya se disparó y evita el reintento diario.
      if (
        wasReviewAlreadyTriggeredForAnniversary(
          contract.start_date,
          todayISO,
          contract.review_triggered_for_anniversary
        )
      ) {
        continue;
      }

      const today = new Date(todayISO);
      let anniversary = new Date(Date.UTC(today.getUTCFullYear(), new Date(contract.start_date).getUTCMonth(), new Date(contract.start_date).getUTCDate()));
      if (anniversary.getTime() < today.getTime()) {
        anniversary = new Date(
          Date.UTC(today.getUTCFullYear() + 1, new Date(contract.start_date).getUTCMonth(), new Date(contract.start_date).getUTCDate())
        );
      }
      const anniversaryISO = anniversary.toISOString().slice(0, 10);

      const { data: lastReview } = await supabase
        .from("contract_reviews")
        .select("created_at")
        .eq("contract_id", contract.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const since = lastReview?.created_at ?? contract.start_date;

      const relevantAlerts = (allAlerts || []).filter((a) => new Date(a.detected_at).getTime() > new Date(since).getTime());
      const summary = summarizeLegalChangesForReview(
        relevantAlerts.map((a) => ({
          alertId: a.id,
          changeDescription: a.change_description,
          detectedAtISO: a.detected_at,
        }))
      );

      const { error: insertError, data: inserted } = await supabase
        .from("contract_reviews")
        .upsert(
          {
            contract_id: contract.id,
            trigger_date: todayISO,
            anniversary_date: anniversaryISO,
            legal_changes_summary: summary,
            status: "pending",
            proposed_terms: {
              frequency: contract.frequency,
              basePrice: contract.base_price,
              total: contract.total,
              serviceSubtype: contract.service_subtype,
            },
          },
          { onConflict: "contract_id,anniversary_date", ignoreDuplicates: true }
        )
        .select();

      if (insertError) {
        results.push({ contractId: contract.id, created: false });
        continue;
      }
      const created = (inserted || []).length > 0;
      if (created) {
        reviewsCreated++;
        // Marca este aniversario como ya disparado para que la ventana de
        // 60 días no reintente el resto de los días (ver guarda arriba).
        await supabase
          .from("service_contracts")
          .update({ review_triggered_at: new Date().toISOString(), review_triggered_for_anniversary: anniversaryISO })
          .eq("id", contract.id);
      }
      results.push({ contractId: contract.id, created });
    }

    return NextResponse.json({ evaluated: (contracts || []).length, reviewsCreated, results }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
