import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import type { Metadata } from "next";
import { Inter, Noto_Sans_SC } from "next/font/google";
import { isPublicInsuredClaimReady } from "@/lib/business-insurance";
import "../globals.css";

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
  return {
    title: t('title'),
    description,
    keywords: t('keywords')
      .split(',')
      .map((k: string) => k.trim()),
    icons: {
      icon: "/favicon.ico",
    },
    manifest: "/manifest.json",
    openGraph: {
      title: t('title'),
      description,
      type: "website",
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
