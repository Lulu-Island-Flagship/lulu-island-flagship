export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminUpsellsClient from "@/components/admin/AdminUpsellsClient";

export default function AdminUpsellsPage() {
  return <AdminUpsellsClient />;
}
