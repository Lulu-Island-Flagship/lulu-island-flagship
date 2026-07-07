export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminServicioDetailClient from "@/components/admin/AdminServicioDetailClient";

export default function AdminServicioDetailPage() {
  return <AdminServicioDetailClient />;
}
