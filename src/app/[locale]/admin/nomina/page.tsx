import type { Metadata } from "next";
import AdminNominaClient from "@/components/admin/AdminNominaClient";

export const metadata: Metadata = { title: "Payroll" };

export default function PayrollExportPage() {
  return <AdminNominaClient />;
}
