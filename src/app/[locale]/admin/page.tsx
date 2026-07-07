export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminDashboardClient from "@/components/admin/AdminDashboardClient";

export default function AdminDashboardPage() {
  return <AdminDashboardClient />;
}
