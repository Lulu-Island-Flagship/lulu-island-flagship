import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // Note: requestLocale is resolved by the middleware
  // We use a default here for static rendering during build
  const locale = 'en';
  return {
    messages: (await import(`../../messages/${locale}.json`)).default,
    locale,
  };
});