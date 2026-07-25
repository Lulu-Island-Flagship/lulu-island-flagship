import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
// Fix (auditoría externa 2026-07-24, seguridad de headers HTTP): faltaban
// HSTS, Permissions-Policy y CSP. Ver comentarios inline en headers() para
// el razonamiento de cada valor.
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Fix (auditoría externa 2026-07-24): fuerza HTTPS en el navegador
          // (incluye subdominios y elegible para la preload list de Chrome).
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Fix (auditoría externa 2026-07-24): deniega APIs de navegador que
          // esta app no usa. geolocation SÍ se usa de verdad -- ver
          // navigator.geolocation en src/app/[locale]/empleado/page.tsx,
          // src/app/[locale]/empleado/servicio/[orderId]/page.tsx y
          // src/components/empleado/SafetyAbortButton.tsx (check-in/check-out
          // y botón de seguridad del empleado in situ) -- por eso se permite
          // solo para el propio origen (self), no para terceros embebidos.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()',
          },
          // Fix (auditoría externa 2026-07-24): Content-Security-Policy.
          // Dominios externos confirmados en el repo: Stripe.js/Stripe
          // Elements (js.stripe.com, api.stripe.com -- ver
          // src/lib/stripe-client.ts, src/components/reserva/StripeCardForm.tsx,
          // ApplePayButton.tsx, WalletPayButton.tsx) y Supabase (fetch/websocket
          // vía @supabase/supabase-js a NEXT_PUBLIC_SUPABASE_URL). Google
          // Fonts se sirve vía next/font/google, que auto-hostea los archivos
          // de fuente en build time -- no hay requests en runtime a
          // fonts.googleapis.com/fonts.gstatic.com, así que no se listan.
          // El login de Google/Apple (ver AuthModal.tsx, StaffLoginScreen.tsx)
          // es una redirección de página completa vía
          // supabase.auth.signInWithOAuth, no un iframe ni un script
          // inyectado, así que no requiere una entrada explícita aparte de
          // permitir supabase en connect-src.
          //
          // NEXT_PUBLIC_SUPABASE_URL de producción no está commiteado en este
          // repo (.env.local solo tiene el valor local de desarrollo
          // http://127.0.0.1:54321; .env.example trae un placeholder). Sin el
          // dominio real de producción no se puede armar una whitelist
          // 100% precisa para connect-src sin arriesgar romper la app en
          // producción (login, fetch de datos, etc.) si el dominio real no
          // coincide exactamente con lo que se adivine aquí. Por eso se usa
          // Content-Security-Policy-Report-Only: reporta violaciones en la
          // consola sin bloquear nada, permitiendo verificar la lista de
          // dominios contra tráfico real antes de pasar a la versión que sí
          // bloquea. Cuando se confirme el dominio de producción de
          // Supabase, cambiar el key a 'Content-Security-Policy' y quitar
          // este comentario de aviso.
          {
            key: 'Content-Security-Policy-Report-Only',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://js.stripe.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
              "frame-src https://js.stripe.com https://hooks.stripe.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
