import { NextResponse, NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { QUOTE_CLIENT_COLUMNS } from "@/lib/client-visible-columns";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value; },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
    },
  });
}

/**
 * GET /api/client/invoice/[orderId] — datos JSON del invoice.
 * POST /api/client/invoice/[orderId] — genera y descarga PDF.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const data = await fetchInvoiceData(params);
  if ("error" in data) return NextResponse.json(data, { status: data.status });
  return NextResponse.json(data, { status: 200 });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const data = await fetchInvoiceData(params);
  if ("error" in data) return NextResponse.json(data, { status: data.status });

  const { invoiceNumber, issueDate, serviceDate, address, serviceType, serviceSubtype, subtotal, gst, pst, total } = data;

  // Generar PDF con jspdf
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const left = 20;
  let y = 20;

  doc.setFontSize(18);
  doc.text("Lulu Island Flagship", left, y);
  y += 7;
  doc.setFontSize(9);
  doc.text("Richmond, BC, Canada  |  GST/HST Registered", left, y);
  y += 12;

  // Invoice header
  doc.setFontSize(14);
  doc.text("INVOICE", left, y);
  doc.setFontSize(9);
  doc.text(`#${invoiceNumber}`, 190, y, { align: "right" });
  y += 6;
  doc.text(`Issue date: ${issueDate}`, left, y);
  y += 10;

  // Service details
  doc.setFontSize(10);
  doc.text("Service Details", left, y);
  y += 7;
  doc.setFontSize(9);
  doc.text(`Service date: ${serviceDate}`, left, y);
  y += 5;
  doc.text(`Type: ${serviceSubtype || serviceType || "Cleaning"}`, left, y);
  if (address) { y += 5; doc.text(`Address: ${address}`, left, y); }
  y += 10;

  // Pricing table
  const col1 = left;
  const col2 = 190;
  doc.setFontSize(10);
  doc.text("Description", col1, y);
  doc.text("Amount (CAD)", col2, y, { align: "right" });
  y += 2;
  doc.line(col1, y, col2, y);
  y += 6;

  doc.setFontSize(9);
  doc.text("Subtotal", col1, y);
  doc.text(`$${subtotal.toFixed(2)}`, col2, y, { align: "right" });
  y += 5;
  doc.text("GST (5%)", col1, y);
  doc.text(`$${gst.toFixed(2)}`, col2, y, { align: "right" });
  y += 5;
  doc.text("PST (7%)", col1, y);
  doc.text(`$${pst.toFixed(2)}`, col2, y, { align: "right" });
  y += 3;
  doc.line(col1, y, col2, y);
  y += 5;
  doc.setFontSize(10);
  doc.text("TOTAL (CAD)", col1, y);
  doc.text(`$${total.toFixed(2)}`, col2, y, { align: "right" });
  y += 15;

  doc.setFontSize(8);
  doc.text("Thank you for choosing Lulu Island Flagship!", 105, y, { align: "center" });

  const pdfBytes = doc.output("arraybuffer");

  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${invoiceNumber}.pdf"`,
    },
  });
}

// ── Helper: datos compartidos entre GET y POST ─────────────────────────────

interface InvoiceData {
  invoiceNumber: string;
  issueDate: string;
  orderId: string;
  serviceDate: string;
  address: string | null;
  serviceType: string | null;
  serviceSubtype: string | null;
  subtotal: number;
  gst: number;
  pst: number;
  total: number;
  status: string;
}

async function fetchInvoiceData(params: Promise<{ orderId: string }>): Promise<InvoiceData | { error: string; status: number }> {
  const { orderId } = await params;
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 };

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) return { error: clientGuard.error as string, status: clientGuard.status };

  const { data: order, error } = await supabase
    .from("orders")
    .select(`id, service_date, status, quotes:quote_id (${QUOTE_CLIENT_COLUMNS})`)
    .eq("id", orderId)
    .eq("user_id", user.id)
    .single();

  if (error || !order) return { error: "Not found", status: 404 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (order as any).quotes;
  const quote = Array.isArray(q) ? q[0] : q;
  const subtotal = Number(quote?.subtotal ?? 0);
  const gst = Number(quote?.gst ?? Math.round(subtotal * 0.05 * 100) / 100);
  const pst = Number(quote?.pst ?? Math.round(subtotal * 0.07 * 100) / 100);
  const total = Number(quote?.total ?? subtotal + gst + pst);
  const serviceDate = (order as { service_date: string }).service_date;

  return {
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
  };
}
