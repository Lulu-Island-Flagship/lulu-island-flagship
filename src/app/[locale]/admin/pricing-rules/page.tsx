export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminPricingRulesClient from "@/components/admin/AdminPricingRulesClient";

export default function AdminPricingRulesPage() {
  return <AdminPricingRulesClient />;
}
