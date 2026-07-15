export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import CommunicationPreferencesClient from "@/components/cuenta/CommunicationPreferencesClient";

export default function PreferenciasPage() {
  return <CommunicationPreferencesClient />;
}
