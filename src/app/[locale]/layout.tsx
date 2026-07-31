import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_SC } from "next/font/google";
import { isPublicInsuredClaimReady } from "@/lib/business-insurance";
import { locales } from "@/i18n/config";
import { BRAND } from "@/design/tokens";
import "../globals.css";

// Dominio canónico del sitio -- mismo valor que ya se usa en el JSON-LD
// LocalBusiness de src/app/[locale]/page.tsx ("url": "https://
// luluislandflagship.ca") y en public/robots.txt (Sitemap:). Se centraliza
// aquí porque generateMetadata también lo necesita para alternates.languages.
const SITE_URL = "https://luluislandflagship.ca";

// Fix (auditoría transversal 2026-07-25, item 2): themeColor/viewport ya no
// van dentro del objeto `metadata` en Next.js 14 -- generan un warning de
// build ("Unsupported metadata viewport/themeColor") y se mueven a su propio
// export `viewport` (API estable desde Next 14.0, confirmado por la versión
// "next": "14.2.35" en package.json). Usa BRAND.navy de
// src/design/tokens.ts (el mismo azul ya usado como color primario en toda
// la marca "Powder Sky") en vez del hex literal, para el guardrail de CI
// "cero hex de marca fuera de la fuente única".
export const viewport: Viewport = {
  themeColor: BRAND.navy,
  width: "device-width",
  initialScale: 1,
};

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sc",
  display: "swap",
});

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'meta' });
  // v8.3 P0-4 fix (auditoría Fable5, B.4/B.2.25): el meta description NUNCA
  // debe afirmar "insured" hasta que las 3 pólizas reales estén contratadas
  // y registradas en business_insurance_policies. generateMetadata corre en
  // servidor, así que el check se hace directo aquí (fail-closed a false).
  const insuredClaimReady = await isPublicInsuredClaimReady();
  const description = t(insuredClaimReady ? 'descriptionInsured' : 'description');
  const title = t('title');

  // Fix (auditoría transversal 2026-07-25, item 2): alternates.languages
  // (hreflang) para los 3 locales + x-default, mismo patrón que
  // src/app/sitemap.ts (fix item 4) -- ambos apuntan a SITE_URL/{locale}/,
  // la home de cada idioma, porque este layout es compartido por TODAS las
  // páginas bajo [locale] y no conoce la sub-ruta actual aquí.
  const languageAlternates: Record<string, string> = {};
  for (const l of locales) {
    languageAlternates[l] = `${SITE_URL}/${l}`;
  }

  return {
    title,
    description,
    keywords: t('keywords')
      .split(',')
      .map((k: string) => k.trim()),
    icons: {
      icon: "/favicon.ico",
    },
    manifest: "/manifest.json",
    alternates: {
      canonical: `${SITE_URL}/${params.locale}`,
      languages: languageAlternates,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${SITE_URL}/${params.locale}`,
      // NOTA: no existe todavía un archivo de imagen OG en /public (se
      // verificó el directorio -- solo hay favicon.ico, icon-192.png,
      // icon-512.png). Se referencia esta ruta por convención para que el
      // metadata quede completo apenas el equipo suba el archivo real
      // (1200x630px recomendado); hasta entonces, este campo no romperá
      // nada -- los crawlers simplemente no encontrarán la imagen (404) y
      // mostrarán la tarjeta sin imagen, igual que hoy.
      images: ["/og-image.jpg"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.jpg"],
    },
  };
}

export async function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'zh' }, { locale: 'fr' }];
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: Readonly<{
  children: React.ReactNode;
  params: { locale: string };
}>) {
  // Fix (auditoría transversal 2026-07-25, item 3): next-intl requiere
  // llamar setRequestLocale(locale) temprano en cada layout/página estática
  // para que su optimización de renderizado estático (generateStaticParams
  // ya presente arriba) funcione -- sin esto, next-intl cae a comportamiento
  // dinámico incluso en rutas que podrían prerenderizarse. Debe llamarse
  // ANTES de cualquier hook de next-intl (getMessages incluido).
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html lang={locale} className={`${inter.variable} ${notoSansSC.variable}`}>
      <body className="antialiased font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
