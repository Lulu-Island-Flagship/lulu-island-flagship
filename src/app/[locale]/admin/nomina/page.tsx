import type { Metadata } from "next";
import AdminNominaClient from "@/components/admin/AdminNominaClient";

export const metadata: Metadata = { title: "Nómina" };

export default function PayrollExportPage() {
  return <AdminNominaClient />;
}
