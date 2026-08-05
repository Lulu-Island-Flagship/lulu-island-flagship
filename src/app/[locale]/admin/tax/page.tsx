import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import TaxDashboard from "@/components/admin/TaxDashboard";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "admin.nav" });
  return { title: t("links.tax") };
}

export default function TaxPage() {
  return (
    <div>
      <TaxDashboard />
    </div>
  );
}
