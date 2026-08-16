import { NextResponse } from "next/server";

import { QUOTE_CLIENT_COLUMNS } from "@/lib/client-visible-columns";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
import { computeTaxBreakdown } from "@/lib/pricing";
/**
 * GET /api/client/invoice/[orderId] — datos JSON del invoice.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const supabase = await createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });

  const { data: order, error } = await supabase
    .from("orders")
    .select(`id, service_date, status, quotes:quote_id (${QUOTE_CLIENT_COLUMNS})`)
    .eq("id", orderId)
    .eq("user_id", user.id)
    .single();

  if (error || !order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const q = (order as { quotes?: unknown }).quotes;
  const quote = Array.isArray(q) ? q[0] : q;
  const subtotal = Number(quote?.subtotal ?? 0);
  // Fallback exacto (sin float): recomputa GST/PST con aritmética entera.
  const fallbackTax = computeTaxBreakdown(subtotal);
  const gst = Number(quote?.gst ?? fallbackTax.gst);
  const pst = Number(quote?.pst ?? fallbackTax.pst);
  const total = Number(quote?.total ?? subtotal + gst + pst);
  const serviceDate = (order as { service_date: string }).service_date;

  return NextResponse.json({
    invoiceNumber: `LULU-${(order as { id: string }).id.slice(0, 8).toUpperCase()}`,
    issueDate: serviceDate,
    orderId: (order as { id: string }).id,
    serviceDate,
    address: quote?.address ?? null,
    serviceType: quote?.service_type ?? null,
    serviceSubtype: quote?.service_subtype ?? null,
    subtotal,
    gst,
    pst,
    total,
    status: (order as { status: string }).status,
  });
}
