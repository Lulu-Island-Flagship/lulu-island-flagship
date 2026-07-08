export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminPricingSettingsClient from "@/components/admin/AdminPricingSettingsClient";

export default function AdminPricingSettingsPage() {
  return <AdminPricingSettingsClient />;
}
