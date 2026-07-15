import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

/**
 * GET /api/public/live-portfolio — sin autenticación, para el marketing
 * site. v8.3 E5.15: solo expone anonymous_label + selected_photo_url de
 * entradas status='approved' AND anonymization_status='processed' (el
 * RLS de la migración 160 ya aplica ese mismo filtro fail-closed, esta
 * ruta es un espejo explícito para no depender solo del RLS).
 *
 * NOTA HONESTA: anonymization_status pasa a 'processed' SOLO cuando
 * alguien procesa manualmente la foto (difuminado + EXIF-strip real, ver
 * src/lib/live-portfolio.ts) -- este endpoint devolverá una lista vacía
 * hasta que exista esa herramienta/paso, en vez de publicar fotos sin
 * anonimizar.
 */
export async function GET(_request: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from("live_portfolio_candidates")
    .select("id, anonymous_label, selected_photo_url, approved_at")
    .eq("status", "approved")
    .eq("anonymization_status", "processed")
    .order("approved_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entries: data || [] }, { status: 200 });
}
