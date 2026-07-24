import type { Metadata } from "next";
import AdminWalletClient from "@/components/admin/AdminWalletClient";

export const metadata: Metadata = { title: "Wallet" };

export default function AdminWalletPage() {
  return <AdminWalletClient />;
}
