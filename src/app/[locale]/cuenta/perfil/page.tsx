export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import PerfilClient from "@/components/cuenta/PerfilClient";

export default function PerfilPage() {
  return <PerfilClient />;
}
