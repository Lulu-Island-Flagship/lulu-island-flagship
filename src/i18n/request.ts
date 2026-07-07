import { getRequestConfig } from 'next-intl/server';
import { type Locale, defaultLocale } from './config';

export default getRequestConfig(async ({ requestLocale }) => {
  // Resolve locale from request params, fallback to default
  let locale: Locale = defaultLocale;
  try {
    const resolved = await requestLocale;
    if (resolved && ['en', 'zh', 'fr'].includes(resolved)) {
      locale = resolved as Locale;
    }
  } catch {
    // fallback to default
  }
  return {
    messages: (await import(`../../messages/${locale}.json`)).default,
    locale,
  };
});
