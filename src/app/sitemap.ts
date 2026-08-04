import type { MetadataRoute } from "next";
import { locales, defaultLocale } from "@/i18n/config";

// Fix (auditoría transversal 2026-07-25, item 4): public/sitemap.xml era un
// archivo estático que solo listaba home + /cotizador por locale (6 URLs
// fijas), sin las páginas legales (/terminos, /privacidad, /cancelacion) y
// sin ninguna forma de mantenerse sincronizado si se agregan rutas
// públicas nuevas. Este archivo lo reemplaza con la convención de Next.js
// App Router (src/app/sitemap.ts se sirve automáticamente en /sitemap.xml,
// tomando precedencia sobre cualquier archivo estático del mismo nombre en
// /public -- ver nota en public/robots.txt/sitemap.xml).
//
// Rutas incluidas: solo páginas públicas indexables, confirmadas leyendo
// src/app/[locale]/ -- home, cotizador, terminos, privacidad, cancelacion.
// Deliberadamente EXCLUIDAS (ver public/robots.txt, mismos prefijos con
// Disallow): /cuenta, /admin, /empleado, /portal (todas gated por sesión) y
// /encuesta/[token], /nps/[token], /evaluar/[token] (rutas de un solo uso
// atadas a un token, no tiene sentido indexarlas ni habría un [token] fijo
// que poner aquí). También se excluyen /reserva/[quoteId] y /confirmacion
// por la misma razón (contenido específico de una cotización/orden, no una
// página de marketing genérica).
const PUBLIC_ROUTES = ["", "/quote", "/terms", "/privacy", "/cancellation"] as const;

const SITE_URL = "https://luluislandflagship.ca";

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const route of PUBLIC_ROUTES) {
    const languages: Record<string, string> = {};
    for (const locale of locales) {
      languages[locale] = `${SITE_URL}/${locale}${route}`;
    }
    // x-default apunta al locale por defecto (en), convención estándar de
    // hreflang para el visitante cuyo idioma no matchea ninguna alternativa.
    languages["x-default"] = `${SITE_URL}/${defaultLocale}${route}`;

    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}/${locale}${route}`,
        lastModified: new Date(),
        changeFrequency: route === "" ? "weekly" : "monthly",
        priority: route === "" ? 1.0 : route === "/quote" ? 0.9 : 0.5,
        alternates: { languages },
      });
    }
  }

  return entries;
}
