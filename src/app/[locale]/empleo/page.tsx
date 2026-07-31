import { EmpleoPageContent } from "@/components/empleo/EmpleoPageContent";
import { locales } from "@/i18n/config";

// Página pública /empleo -- punto de entrada del Paso 1 del flujo de
// contratación de candidatos (ver src/lib/hiring-flow/). Mismo patrón que
// src/app/[locale]/terminos/page.tsx: Server Component delgado que delega
// toda la interactividad a un componente cliente separado, porque
// useTranslations/useState no son válidos en un Server Component.
//
// generateStaticParams: mismo patrón usado por src/app/[locale]/layout.tsx
// (que ya prerenderiza los 3 locales) -- se declara también aquí, a nivel
// de página, siguiendo la convención de Next.js App Router de que cada
// segmento dinámico que quiere prerenderizado estático declara su propio
// generateStaticParams (el de layout.tsx cubre el layout compartido, este
// cubre específicamente la ruta /empleo).
export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default function EmpleoPage() {
  return <EmpleoPageContent />;
}
