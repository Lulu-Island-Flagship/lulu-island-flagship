export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminServiciosClient from "@/components/admin/AdminServiciosClient";

export default function AdminServiciosPage() {
  return <AdminServiciosClient />;
}
