import type { Metadata } from "next";
import AdminTicketsClient from "@/components/admin/AdminTicketsClient";

export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

export const metadata: Metadata = { title: "Tickets" };

export default function TicketsPage() {
  return <AdminTicketsClient />;
}
