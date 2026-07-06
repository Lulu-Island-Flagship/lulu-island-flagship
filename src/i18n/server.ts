import { setRequestLocale } from 'next-intl/server';
import { locales, type Locale } from './config';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function setPageLocale(locale: string) {
  const validLocale = locales.includes(locale as Locale) ? locale : 'en';
  setRequestLocale(validLocale);
  return validLocale;
}
