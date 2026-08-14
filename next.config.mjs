import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
// Fix (auditoría externa 2026-07-24, seguridad de headers HTTP): faltaban
// HSTS, Permissions-Policy y CSP. Ver comentarios inline en headers() para
// el razonamiento de cada valor.
const nextConfig = {
  // Fix (auditoría transversal 2026-07-25, item 9): Next.js expone por
  // defecto el header "X-Powered-By: Next.js" en cada respuesta, filtrando
  // stack tecnológico a cualquier scanner externo sin aportar nada al
  // usuario. Se desactiva.
  poweredByHeader: false,
  // Fix (2026-07-25, auditoría UX cliente, item 16 -- galería de servicio):
  // /cuenta/servicios/[orderId]/galeria pasa de <img> plano a next/image
  // (optimización automática de tamaño/formato). Las fotos vienen de
  // Supabase Storage (supabase.storage.from(...).getPublicUrl() /
  // createSignedUrl(), mismo dominio ya permitido en img-src del CSP de
  // abajo, https://*.supabase.co) -- next/image exige declarar el host
  // explícitamente aparte del CSP, así que se añade aquí.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
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
          // Fix (auditoría transversal 2026-07-25, item 9): interest-cohort=()
          // era el opt-out de FLoC (Federated Learning of Cohorts), una
          // propuesta de Chrome que Google abandonó en 2022 en favor de la
          // Privacy Sandbox / Topics API. Ningún navegador actual reconoce ya
          // esta directiva -- queda solo como ruido en el header, se quita.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), magnetometer=(), gyroscope=()',
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
          // 100% precisa acotada a un único subdominio de Supabase --
          // `connect-src` se mantiene con el wildcard `https://*.supabase.co`
          // / `wss://*.supabase.co` a propósito (cualquier proyecto Supabase
          // vive bajo ese sufijo, así que el wildcard no amplía el riesgo
          // real más allá de "solo Supabase").
          //
          // Fix (auditoría transversal 2026-07-25, item 1): esta política
          // pasa de Content-Security-Policy-Report-Only (solo registraba
          // violaciones en consola, no bloqueaba nada) a Content-Security-
          // Policy real (bloquea). Se confirmó primero, leyendo el código
          // fuente, que ninguna directiva se rompería:
          //   - img-src: se acota de `https:` (cualquier host HTTPS) a
          //     `'self' data: blob: https://*.supabase.co`. Se auditaron
          //     todos los <img src=...} del repo (grep "<img"): todas las
          //     imágenes remotas vienen de Supabase Storage
          //     (`supabase.storage.from(...).getPublicUrl()` /
          //     `createSignedUrl()`, ver p.ej.
          //     src/components/empleado/ChecklistCierre.tsx,
          //     AdminQCClient.tsx) o son `data:` URLs (WeChat Pay QR code en
          //     WalletPayButton.tsx viene de
          //     `wechat_pay_display_qr_code.image_data_url`, un data URL de
          //     Stripe, no un fetch a un host externo). No se encontró
          //     ningún <img> ni next/image apuntando a un dominio HTTPS
          //     fuera de Supabase, así que no hace falta el wildcard amplio.
          //   - script-src: se mantiene 'unsafe-inline' -- Next.js 14 (App
          //     Router, sin configuración de nonce en next.config.mjs/
          //     middleware) inyecta scripts inline (__NEXT_DATA__, streaming
          //     de RSC) que necesitan esto para hidratar. Quitarlo requeriría
          //     implementar CSP por nonce (headers dinámicos por request +
          //     wiring en middleware.ts), un cambio de mayor alcance que no
          //     se hace en este fix para no arriesgar romper la hidratación
          //     de toda la app.
          //   - connect-src: se deja el wildcard de Supabase (ver arriba).
          //
          // Propuesta concreta para CSP por nonce (auditoría de seguridad
          // 2026-08-02, evaluada y NO implementada en este fix -- ver
          // justificación abajo):
          //
          //   1. next.config.mjs: quitar la entrada 'Content-Security-Policy'
          //      de este headers() -- pasaría a construirse dinámicamente en
          //      middleware.ts (headers estáticos de next.config.mjs no
          //      pueden variar por request, y el nonce debe ser distinto en
          //      cada uno).
          //   2. middleware.ts: en la función `middleware()`, generar un
          //      nonce por request (`crypto.randomUUID()` o
          //      `Buffer.from(crypto.getRandomValues(new
          //      Uint8Array(16))).toString('base64')`), añadirlo como header
          //      de request (`x-nonce`, vía `NextResponse.next({ request: {
          //      headers } })`) y construir el mismo string de
          //      Content-Security-Policy de arriba pero con
          //      `script-src 'self' 'nonce-${nonce}' https://js.stripe.com`
          //      en vez de 'unsafe-inline', seteándolo como header de
          //      response en cada rama de retorno de middleware() (ruteo de
          //      idioma, redirects de /admin, /empleado, /cuenta, y las
          //      respuestas de los tres prefijos /api protegidos).
          //   3. src/app/[locale]/layout.tsx (root layout): leer el nonce
          //      con `headers().get('x-nonce')` y pasarlo explícitamente a
          //      cualquier <script> propio (actualmente no hay ninguno
          //      custom fuera de lo que Next.js inyecta automáticamente).
          //
          //   Por qué NO se implementa en este fix: bajo Next.js 14.2.35
          //   (esta app), leer `headers()` en el root layout para obtener el
          //   nonce fuerza renderizado dinámico (opt-out de static
          //   optimization) para TODA página que herede ese layout -- es
          //   decir, el sitio completo, incluidas landing pages hoy
          //   estáticas. Ese trade-off de performance/costo de servidor
          //   recién se elimina en Next.js >=15.2 (soporte de nonce con
          //   static rendering). Aplicarlo ahora, sin poder levantar el
          //   dev server ni correr un build completo de forma interactiva
          //   en este entorno para verificar que ninguna página quede rota
          //   (hidratación, RSC streaming, todas las rutas bajo
          //   src/app/[locale]/**), sería una implementación a medias de
          //   alto riesgo -- se prefiere documentar la ruta concreta y
          //   dejar la decisión (y su verificación con `next build` +
          //   smoke test real) para cuando se pueda probar interactivamente,
          //   idealmente junto con la eventual actualización a Next.js 15.x
          //   (ver auditoría de dependencias, mismo commit) que resuelve
          //   ambos problemas a la vez.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://js.stripe.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.ingest.sentry.io",
              // Fix (2026-07-25, auditoría UX cliente, item 2 -- tracking de
              // servicio): se agrega www.google.com para el iframe de
              // Google Maps embebido en /cuenta/servicios/[orderId]/tracking
              // (output=embed, sin API key). Sin esta entrada, frame-src
              // bloquea el iframe por completo y el cliente vuelve a ver
              // solo coordenadas crudas -- justo lo que ese fix buscaba
              // evitar.
              "frame-src https://js.stripe.com https://hooks.stripe.com https://www.google.com/maps/embed",
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
