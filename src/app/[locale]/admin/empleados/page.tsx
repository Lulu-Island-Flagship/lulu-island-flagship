export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminEmpleadosClient from "@/components/admin/AdminEmpleadosClient";

export default function AdminEmpleadosPage() {
  return <AdminEmpleadosClient />;
}
