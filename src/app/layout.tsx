import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { Metadata } from "next";
import { Inter, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Lulu Island Flagship | Cleaning Services | Richmond, BC",
  description:
    "The same trusted team, every time. Verified, insured, and trained to care for your home — not just clean it. Full price from quote, no surprises. Serving Richmond, Vancouver & Metro Vancouver.",
  keywords: [
    "cleaning services",
    "house cleaning",
    "Richmond BC",
    "Vancouver cleaning",
    "deep cleaning",
    "move-in cleaning",
  ],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Lulu Island Flagship | Cleaning Services",
    description:
      "The same trusted team, every time. Full price from quote, no surprises.",
    type: "website",
  },
};

export async function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'zh' }, { locale: 'fr' }];
}

export default async function RootLayout({
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
