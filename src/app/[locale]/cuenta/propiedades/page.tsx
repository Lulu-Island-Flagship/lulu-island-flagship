export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import ClientPropertiesClient from "@/components/cuenta/ClientPropertiesClient";

export default function ClientPropertiesPage() {
  return <ClientPropertiesClient />;
}
