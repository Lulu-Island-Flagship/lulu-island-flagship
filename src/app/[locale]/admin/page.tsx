import type { Metadata } from "next";
import AdminDashboardClient from "@/components/admin/AdminDashboardClient";
import { getCurrentAdminRoles } from "@/lib/admin";

export const metadata: Metadata = { title: "Dashboard" };

export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

// v8.3 fix G-3 (auditoría implacable 2026-07-20b): el dashboard de 45
// tarjetas no filtraba por rol -- solo AdminNav lo hacía. Un qc_only podía
// ver (y navegar a) tarjetas de Pricing Rules, Nómina, etc. con solo saber
// la URL, porque AdminDashboardClient no recibía ni usaba ningún rol.
// Ahora este Server Component trae los roles reales del usuario (mismo
// helper que usa admin/layout.tsx, ver src/lib/admin.ts) y se los pasa a
// AdminDashboardClient para que filtre cada tarjeta con roleAllows(), igual
// que ya hace AdminNav con sus links.
//
// v8.3 fix m-5: el import de AdminDashboardClient vivía DESPUÉS de
// generateStaticParams (orden de declaraciones inválido/inusual) -- ahora
// todos los imports van arriba del archivo, orden normal.
export default async function AdminDashboardPage() {
  const { roles } = await getCurrentAdminRoles();
  return <AdminDashboardClient roles={roles} />;
}
