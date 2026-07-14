export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }, { locale: "fr" }];
}

import MisServiciosClient from "@/components/cuenta/MisServiciosClient";

export default function MisServiciosPage() {
  return <MisServiciosClient />;
}
