// Fix (auditoría transversal 2026-07-25, item 6): red de seguridad en la
// raíz para el caso extremo en que una request no matchea NINGÚN locale
// (p.ej. un asset o ruta rara justo fuera del matcher de
// src/middleware.ts, `['/((?!api|auth|_next|.*\\..*).*)']`, antes de que
// intlMiddleware pueda redirigir a /{locale}). En el flujo normal, con
// localePrefix: 'always', casi toda navegación real cae en
// src/app/[locale]/not-found.tsx en vez de este archivo -- este es solo el
// último fallback. Server Component sin next-intl a propósito, mismo motivo
// que src/app/global-error.tsx: puede ejecutarse antes de que el locale se
// resuelva, así que no depende de NextIntlClientProvider.
export default function RootNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          backgroundColor: "#EAF4FB",
          color: "#1F2E3D",
        }}
      >
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center", padding: "0 16px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
            Page not found
          </h1>
          <p style={{ color: "#4B5563", marginBottom: 24, lineHeight: 1.6 }}>
            The page you&apos;re looking for doesn&apos;t exist or may have moved.
          </p>
          <a
            href="/en"
            style={{
              display: "inline-block",
              backgroundColor: "#2E5C8A",
              color: "#FFFFFF",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 16,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Back to home
          </a>
        </div>
      </body>
    </html>
  );
}
