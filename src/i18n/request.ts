import { getRequestConfig } from 'next-intl/server';
import { type Locale } from './config';

export default getRequestConfig(async () => {
  const locale: Locale = 'en';
  return {
    messages: (await import(`../../messages/${locale}.json`)).default,
    locale,
  };
});
