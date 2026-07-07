export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminChecklistsClient from "@/components/admin/AdminChecklistsClient";

export default function AdminChecklistsPage() {
  return <AdminChecklistsClient />;
}
