import type { Metadata } from "next";
import AdminQCClient from "@/components/admin/AdminQCClient";

export const metadata: Metadata = { title: "QC" };

export default function QCPage() {
  return <AdminQCClient />;
}
