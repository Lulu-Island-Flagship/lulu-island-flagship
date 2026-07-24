import type { Metadata } from "next";

export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import AdminRolesClient from "@/components/admin/AdminRolesClient";

export const metadata: Metadata = { title: "Roles" };

// v8.3 B-2 (auditoría go-live 2026-07-20): pantalla de alta/baja de roles
// administrativos (owner_admin/ops_coordinator/qc_only). Enlazada desde
// AdminNav.tsx, restringida a owner_admin (resource admin_roles_management).
export default function AdminRolesPage() {
  return <AdminRolesClient />;
}
