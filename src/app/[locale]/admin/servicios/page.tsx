import type { Metadata } from "next";

export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminServiciosClient from "@/components/admin/AdminServiciosClient";

export const metadata: Metadata = { title: "Services" };

export default function AdminServiciosPage() {
  return <AdminServiciosClient />;
}
