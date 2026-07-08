export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminPricingRulesSandboxClient from "@/components/admin/AdminPricingRulesSandboxClient";

export default function AdminPricingRulesSandboxPage() {
  return <AdminPricingRulesSandboxClient />;
}
