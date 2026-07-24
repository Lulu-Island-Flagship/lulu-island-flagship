import type { Metadata } from "next";

export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminDispatchClient from "@/components/admin/AdminDispatchClient";

export const metadata: Metadata = { title: "Dispatch" };

export default function AdminDispatchPage() {
  return <AdminDispatchClient />;
}
