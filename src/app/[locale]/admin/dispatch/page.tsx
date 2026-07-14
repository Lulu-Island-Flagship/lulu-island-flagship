export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminDispatchClient from "@/components/admin/AdminDispatchClient";

export default function AdminDispatchPage() {
  return <AdminDispatchClient />;
}
