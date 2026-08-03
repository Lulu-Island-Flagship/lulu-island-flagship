"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Printer } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { formatServiceDateDisplay } from "@/lib/date-utils";

interface InvoiceData {
  orderId: string;
  invoiceNumber?: string;
  issueDate?: string;
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

export default function InvoicePageClient() {
  const t = useTranslations("cuenta.servicios.invoice");
  const params = useParams();
  const orderId = params?.orderId as string;
  const locale = (params?.locale as string) || "en";

  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId) return;
    load();
  }, [orderId]);

  async function load() {
    try {
      const res = await fetch(`/api/client/invoice/${orderId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center print:hidden">
        <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-brand-ink/50 print:hidden">
        {error || t("notFound")}
      </div>
    );
  }

  const invoiceNumber = data.invoiceNumber || `LULU-${orderId.slice(0, 8).toUpperCase()}`;
  const issueDate = data.issueDate || data.serviceDate;

  return (
    <>
      <div className="max-w-2xl mx-auto px-4 py-4 print:hidden">
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-navy text-white rounded-lg text-sm font-medium hover:bg-brand-navy/90"
        >
          <Printer className="w-4 h-4" />
          {t("print")}
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 bg-white print:max-w-full print:px-12 print:py-0">
        <div className="border-b-2 border-brand-navy pb-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-brand-navy print:text-black">Lulu Island Flagship</h1>
              <p className="text-sm text-brand-ink/60 mt-1">Richmond, BC, Canada</p>
              <p className="text-xs text-brand-ink/40 mt-0.5">GST/HST Registered</p>
            </div>
            <div className="text-right">
              <h2 className="text-xl font-bold text-brand-navy print:text-black">{t("title")}</h2>
              <p className="text-sm text-brand-ink/60 mt-1">#{invoiceNumber}</p>
              <p className="text-xs text-brand-ink/40 mt-0.5">{t("issueDate")}: {issueDate}</p>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-semibold text-brand-ink/60 uppercase tracking-wider mb-3">{t("serviceDetails")}</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-brand-ink/50 text-xs">{t("serviceDate")}</p>
              <p className="text-brand-ink font-medium">
                {formatServiceDateDisplay(data.serviceDate, locale)}
              </p>
            </div>
            <div>
              <p className="text-brand-ink/50 text-xs">{t("serviceType")}</p>
              <p className="text-brand-ink font-medium">
                {data.serviceSubtype || data.serviceType || t("cleaning")}
              </p>
            </div>
            {data.address && (
              <div className="col-span-2">
                <p className="text-brand-ink/50 text-xs">{t("address")}</p>
                <p className="text-brand-ink font-medium">{data.address}</p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-brand-ice pt-4">
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="py-1.5 text-brand-ink/60">{t("subtotal")}</td>
                <td className="py-1.5 text-right text-brand-ink">{formatCurrency(data.subtotal, locale)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-brand-ink/60">{t("gst")} (5%)</td>
                <td className="py-1.5 text-right text-brand-ink">{formatCurrency(data.gst, locale)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-brand-ink/60">{t("pst")} (7%)</td>
                <td className="py-1.5 text-right text-brand-ink">{formatCurrency(data.pst, locale)}</td>
              </tr>
              <tr className="border-t-2 border-brand-navy">
                <td className="py-2 font-bold text-brand-ink">{t("total")} (CAD)</td>
                <td className="py-2 text-right font-bold text-brand-navy print:text-black">
                  {formatCurrency(data.total, locale)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-8 pt-4 border-t border-brand-ice text-xs text-brand-ink/40 text-center">
          <p>{t("thankYou")}</p>
          <p className="mt-1">Lulu Island Flagship · Richmond, BC · Cleaning Services</p>
        </div>
      </div>
    </>
  );
}
