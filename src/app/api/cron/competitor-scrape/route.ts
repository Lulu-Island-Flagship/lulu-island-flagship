// Fix (auditoría MANIFEST v4.2 · E.5): I/O externa que puede superar el
// timeout serverless por defecto (10s).
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";

import { MAX_TRACKED_COMPETITORS, detectCompetitorAlerts, type CompetitorSnapshot } from "@/lib/competitor-tracking";
import { scrapeCompetitor, type ScrapeConfig } from "@/lib/competitor-scraper";
import { requireCronAuth } from "@/lib/cron-auth";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";
// GET /api/cron/competitor-scrape — v8.3 E10 (D.10.10, Sesión O)
// Protegido por CRON_SECRET, mismo patrón que /api/cron/weekly-scores.
//
// Recorre SOLO competidores con scrape_enabled = true (migración 113) —
// un humano decidió explícitamente que ese sitio es público y configuró
// scrape_config. Nunca toca competidores en modo manual (scrape_url NULL o
// scrape_enabled = false): esos siguen alimentándose por el checklist
// mensual de E1 vía POST /api/admin/competencia, sin ningún cambio.
//
// Por cada competidor scrapeable: descarga la página (respeta robots.txt,
// ver competitor-scraper.ts), extrae los campos configurados, y si logra un
// precio (único campo obligatorio) inserta un nuevo competitor_snapshots
// con source='scraping' — LA MISMA tabla que usa el checklist manual
// (criterio de aceptación E10: no se rompe el panel existente). Corre
// detectCompetitorAlerts() contra el snapshot anterior de ese competidor,
// igual que hace hoy el endpoint manual.
//
// Si la extracción falla (robots.txt lo prohíbe, timeout, el sitio cambió su
// HTML y el regex ya no matchea, etc.) NO se inventa un snapshot: se anota
// el error en competitors.last_scrape_error para que un humano lo revise, y
// se sigue con el siguiente competidor.
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = await createRouteSupabaseClient();

    const { data: allActiveCompetitors, error: allCompError } = await supabase
      .from("competitors")
      .select("id")
      .is("deleted_at", null);
    if (allCompError) {
      console.error("allCompError:", allCompError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    const knownCompetitorIds = (allActiveCompetitors || []).map((c: { id: string }) => c.id);

    const { data: scrapableCompetitors, error: compError } = await supabase
      .from("competitors")
      .select("id, name, zone, scrape_url, scrape_config")
      .is("deleted_at", null)
      .eq("scrape_enabled", true)
      .not("scrape_url", "is", null);
    if (compError) {
      console.error("compError:", compError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // Defensivo: canAddCompetitor ya impide superar el tope al insertar, pero
    // si por algún motivo hubiera más de 10, no procesamos de más (spec:
    // "hasta 10 competidores").
    const toProcess = (scrapableCompetitors || []).slice(0, MAX_TRACKED_COMPETITORS);

    const scraped: Array<{ competitorId: string; name: string; alertsCreated: number }> = [];
    const skipped: Array<{ competitorId: string; name: string; reason: string }> = [];

    for (const competitor of toProcess as Array<{
      id: string;
      name: string;
      zone: string;
      scrape_url: string;
      scrape_config: ScrapeConfig | null;
    }>) {
      const result = await scrapeCompetitor({
        competitorId: competitor.id,
        competitorName: competitor.name,
        zone: competitor.zone,
        scrapeUrl: competitor.scrape_url,
        scrapeConfig: competitor.scrape_config ?? {},
      });

      if (!result.success) {
        await supabase
          .from("competitors")
          .update({ last_scraped_at: new Date().toISOString(), last_scrape_error: result.error })
          .eq("id", competitor.id);
        skipped.push({ competitorId: competitor.id, name: competitor.name, reason: result.error });
        continue;
      }

      const { data: previousRow } = await supabase
        .from("competitor_snapshots")
        .select("*")
        .eq("competitor_id", competitor.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const current: CompetitorSnapshot = {
        competitorId: competitor.id,
        competitorName: competitor.name,
        capturedAt: new Date().toISOString(),
        source: "scraping",
        priceCents: result.data.priceCents,
        services: result.data.services,
        activePromotions: result.data.activePromotions,
        averageRating: result.data.averageRating ?? 0,
        reviewCount: result.data.reviewCount,
        zone: competitor.zone,
      };

      const previous: CompetitorSnapshot | null = previousRow
        ? {
            competitorId: previousRow.competitor_id,
            competitorName: competitor.name,
            capturedAt: previousRow.captured_at,
            source: previousRow.source,
            priceCents: previousRow.price_cents,
            services: previousRow.services,
            activePromotions: previousRow.active_promotions,
            averageRating: Number(previousRow.average_rating),
            reviewCount: previousRow.review_count,
            zone: competitor.zone,
          }
        : null;

      const { error: insertError } = await supabase.from("competitor_snapshots").insert({
        competitor_id: current.competitorId,
        source: "scraping",
        price_cents: current.priceCents,
        services: current.services,
        active_promotions: current.activePromotions,
        average_rating: current.averageRating || null,
        review_count: current.reviewCount,
      });
      if (insertError) {
        skipped.push({ competitorId: competitor.id, name: competitor.name, reason: `Insert falló: ${insertError.message}` });
        continue;
      }

      // knownCompetitorIds ya incluye a este competidor (existía antes de
      // correr el cron), así que detectCompetitorAlerts nunca dispara
      // "nuevo" aquí — mismo comportamiento documentado en el endpoint
      // manual (POST /api/admin/competencia): "nuevo" es para altas via
      // add_competitor, no para snapshots de competidores ya conocidos.
      const alerts = detectCompetitorAlerts(current, previous, knownCompetitorIds);

      if (alerts.length > 0) {
        await supabase.from("competitor_alerts").insert(
          alerts.map((a) => ({
            competitor_id: a.competitorId,
            alert_type: a.type,
            severity: a.severity,
            reason: a.reason,
          }))
        );
      }

      await supabase
        .from("competitors")
        .update({ last_scraped_at: new Date().toISOString(), last_scrape_error: null })
        .eq("id", competitor.id);

      scraped.push({ competitorId: competitor.id, name: competitor.name, alertsCreated: alerts.length });
    }

    return NextResponse.json(
      {
        processed: toProcess.length,
        scraped,
        skipped,
        alertsCreated: scraped.reduce((sum, s) => sum + s.alertsCreated, 0),
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}
