export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import DashboardClient from "@/components/cuenta/DashboardClient";

export default function CuentaDashboardPage() {
  return <DashboardClient />;
}
