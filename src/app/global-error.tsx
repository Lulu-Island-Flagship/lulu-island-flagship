"use client";

// Fix (auditoría transversal 2026-07-25, item 6): no existía ningún
// global-error.tsx en la raíz de src/app/ -- un error lanzado en
// src/app/layout.tsx o src/app/[locale]/layout.tsx mismos (no en una página
// hija) no tiene ningún error.tsx por encima que lo capture, así que Next.js
// exige específicamente global-error.tsx en la raíz para ese caso
// (https://nextjs.org/docs/app/api-reference/file-conventions/error#global-errortsx).
//
// Esto reemplaza el layout raíz COMPLETO mientras está activo -- por eso
// debe traer sus propias etiquetas <html>/<body> (src/app/layout.tsx normal
// nunca las tiene: ver ese archivo, es solo `return children`, las etiquetas
// html/body reales viven en src/app/[locale]/layout.tsx). Corre fuera de
// NextIntlClientProvider (el error puede ser justamente que ese provider o
// el locale layout fallaron al montar), así que NO puede usar
// useTranslations/next-intl -- texto fijo en inglés con estilos inline
// (sin depender de que Tailwind/globals.css hayan cargado) como red de
// seguridad de último recurso. BRAND de src/design/tokens.ts es una const
// de string plano (sin CSS/Tailwind/next-intl), así que importarla aquí no
// rompe ese aislamiento -- evita duplicar los hex a mano (guardrail de CI
// "cero hex de marca fuera de la fuente única").
import { useEffect } from "react";
import { BRAND } from "@/design/tokens";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

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
          color: BRAND.ink,
        }}
      >
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center", padding: "0 16px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
            Something went wrong
          </h1>
          <p style={{ color: "#4B5563", marginBottom: 24, lineHeight: 1.6 }}>
            An unexpected error occurred and the page could not load. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              backgroundColor: BRAND.navy,
              color: "#FFFFFF",
              border: "none",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 16,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
