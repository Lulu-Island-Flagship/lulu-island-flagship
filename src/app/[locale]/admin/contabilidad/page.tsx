import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import AdminContabilidadClient from "@/components/admin/AdminContabilidadClient";

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "admin.nav" });
  return { title: t("links.contabilidad") };
}

export default function ContabilidadPage() {
  return <AdminContabilidadClient />;
}
