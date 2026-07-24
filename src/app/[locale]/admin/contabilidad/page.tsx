import type { Metadata } from "next";
import AdminContabilidadClient from "@/components/admin/AdminContabilidadClient";

export const metadata: Metadata = { title: "Contabilidad" };

export default function ContabilidadPage() {
  return <AdminContabilidadClient />;
}
