"use client";

import { Suspense, useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import Script from "next/script";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ship, Shield, Users, Clock, Star, MapPin, LogIn, UserPlus } from "lucide-react";
import { QuoteButton } from "@/components/landing/QuoteButton";
import { LanguageSelector } from "@/components/LanguageSelector";
import { AuthModal } from "@/components/cotizador/AuthModal";
import { isAllowedInternalPath } from "@/lib/safe-redirect";

// Fix (auditoría en vivo 2026-08-01, prueba E2E como cliente real): middleware.ts
// (líneas ~243-253) redirige del lado del servidor cualquier visita sin sesión a
// /[locale]/cuenta/** de vuelta al home con "?next=<ruta original>" -- pero ese
// param nunca se consumía. El link "Sign In" del header (líneas ~116/141 de este
// archivo) manda ahí, así que un cliente sin sesión que hacía clic terminaba de
// vuelta en el home sin modal, sin error, sin ninguna explicación de qué pasó.
// Este componente lee "next", y si es una ruta interna válida (misma allowlist
// que ya usa el middleware), abre el AuthModal real -- el mismo que ya usa el
// flujo de cotización -- y al autenticarse redirige a esa ruta original.
// Envuelto en <Suspense> porque useSearchParams lo exige para no sacar la página
// entera de la renderización estática.
function NextParamAuthGate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathLocale = pathname.match(/^\/(en|zh|fr)(\/|$)/);
  const locale = pathLocale ? pathLocale[1] : "en";
  const nextParam = searchParams.get("next");
  const [dismissed, setDismissed] = useState(false);

  if (!nextParam || dismissed || !isAllowedInternalPath(nextParam)) return null;

  return (
    <AuthModal
      onClose={() => {
        // No tiene caso reintentar el destino protegido tras cerrar -- se
        // limpia el query param y se deja al usuario en el home normal,
        // mismo patrón que cuenta/layout.tsx usa para su propio AuthModal.
        setDismissed(true);
        router.replace(`/${locale}`);
      }}
      onSuccess={() => {
        router.push(nextParam);
      }}
    />
  );
}

function LocalBusinessSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Lulu Island Flagship Cleaning Services",
    // v8.3 E7 fix de auditoría (D.9 punto 9 / B.4 regla #25): este texto
    // decía literalmente "insured" de forma incondicional en el JSON-LD
    // público, violando la regla explícita del spec ("Nunca publicar
    // asegurados/bonded en el sitio hasta que las pólizas reales estén
    // contratadas") sin importar el estado real de
    // business_insurance_policies (src/lib/business-insurance.ts,
    // GET /api/admin/business-insurance -> allThreePoliciesReady).
    //
    // v8.3 P0-4 fix (auditoría Fable5): el resto de la copia VISIBLE de esta
    // página (bloque "trust" + hero + meta description en layout.tsx) SÍ
    // quedó condicionada, vía GET /api/public/insured-status (fail-closed) —
    // ver `insuredClaimReady` más abajo. Este JSON-LD sigue sin afirmar
    // "insured/bonded" en absoluto, a propósito: es un componente estático
    // sin acceso a ese estado en build time, así que el texto base se
    // mantiene siempre neutro en vez de intentar condicionarlo aquí también.
    "description": "Vetted, trained cleaning professionals caring for your home — not just cleaning it. Full price from quote, no surprises.",
    "url": "https://luluislandflagship.ca",
    "email": "hello@luluislandflagship.ca",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Richmond",
      "addressRegion": "BC",
      "addressCountry": "CA"
    },
    "areaServed": [
      { "@type": "City", "name": "Richmond" },
      { "@type": "City", "name": "Vancouver" },
      { "@type": "City", "name": "North Vancouver" },
      { "@type": "City", "name": "West Vancouver" },
      { "@type": "Place", "name": "UBC" }
    ],
    "serviceType": [
      "House Cleaning",
      "Deep Cleaning",
      "Move-In/Move-Out Cleaning",
      "Office Cleaning",
      "Airbnb Cleaning",
      "Post-Construction Cleaning"
    ],
    "priceRange": "$$"
  };

  return (
    <Script
      id="local-business-schema"
      type="application/ld+json"
      strategy="afterInteractive"
    >
      {JSON.stringify(schema)}
    </Script>
  );
}

export default function HomePage() {
  const t = useTranslations();
  const pathname = usePathname();
  const pathLocale = pathname.match(/^\/(en|zh|fr)(\/|$)/);
  const locale = pathLocale ? pathLocale[1] : "en";

  // v8.3 P0-4 fix (auditoría Fable5, B.4/B.2.25): la copia visible NUNCA
  // afirma "insured" por defecto -- fail-closed a `false` hasta que
  // /api/public/insured-status confirme que las 3 pólizas reales están
  // activas y registradas. Ese endpoint nunca expone datos de las pólizas,
  // solo el booleano derivado (ver src/lib/business-insurance.ts).
  const [insuredClaimReady, setInsuredClaimReady] = useState(false);
  const [_authModal, setAuthModal] = useState<"signin" | "signup" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/insured-status")
      .then((res) => (res.ok ? res.json() : { insuredClaimReady: false }))
      .then((data) => {
        if (!cancelled) setInsuredClaimReady(Boolean(data.insuredClaimReady));
      })
      .catch(() => {
        if (!cancelled) setInsuredClaimReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-white">
      <LocalBusinessSchema />
      <Suspense fallback={null}>
        <NextParamAuthGate />
      </Suspense>

      {/* Header — v8.3 rediseño "Powder Sky": fondo claro, no bloque oscuro */}
      <header className="bg-white border-b border-brand-ice">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Ship className="w-8 h-8 text-brand-navy" />
            <div>
              <h1 className="text-lg font-bold tracking-tight text-brand-ink">Lulu Island Flagship</h1>
              <p className="text-xs text-brand-wave-blue">Cleaning Services</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <span className="flex items-center gap-1 text-brand-navy">
              <MapPin className="w-4 h-4" />
              {t('nav.location')}
            </span>
            <button
              onClick={() => setAuthModal("signin")}
              className="flex items-center gap-1 text-brand-navy hover:text-brand-wave-blue transition-colors"
            >
              <LogIn className="w-4 h-4" />
              {t('nav.signIn')}
            </button>
            <button
              onClick={() => setAuthModal("signup")}
              className="flex items-center gap-1 bg-brand-navy text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              {t('nav.signUp')}
            </button>
            <LanguageSelector />
          </nav>
          {/* v8.3 fix (auditoría M-1): el link de "Iniciar sesión" vivía SOLO
              dentro del <nav> "hidden md:flex" -- en mobile (menos de md)
              el cliente no tenía ninguna forma de llegar a /cuenta. Se
              agrega este link duplicado, visible únicamente por debajo de
              md (md:hidden), fuera del nav oculto. No se toca el resto del
              nav (LanguageSelector, ubicación) para no alterar el layout
              mobile existente en otras partes del header.

              Fix (auditoría UX 2026-07-25, items 7-8): este bloque mobile
              mostraba SOLO el ícono de login con texto oculto (sr-only) --
              ni el selector de idioma (LanguageSelector) ni un texto de
              "Sign In" visible aparecían en mobile. Se agrega el
              LanguageSelector junto al link, y el texto ya no es sr-only:
              queda visible junto al ícono, igual que en desktop. */}
          <div className="md:hidden flex items-center gap-2">
            <LanguageSelector />
            <button
              onClick={() => setAuthModal("signin")}
              aria-label={t('nav.signIn')}
              className="flex items-center gap-1 text-brand-navy hover:text-brand-wave-blue transition-colors text-sm"
            >
              <LogIn className="w-4 h-4" />
              <span>{t('nav.signIn')}</span>
            </button>
            <button
              onClick={() => setAuthModal("signup")}
              className="flex items-center gap-1 bg-brand-navy text-white px-2 py-1 rounded-lg text-xs font-medium hover:bg-brand-navy-light transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{t('nav.signUp')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero — fondo celeste muy pálido, sin overlays oscuros */}
      <section className="bg-brand-ice relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28 relative">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-brand-gold/25 text-brand-gold-dark px-4 py-1.5 rounded-full text-sm font-medium mb-6">
              <Star className="w-4 h-4 fill-brand-gold-dark" />
              {t('hero.badge')}
            </div>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6 text-brand-ink">
              {t('hero.title')}{" "}
              <span className="text-brand-navy">{t('hero.titleHighlight')}</span>
            </h2>
            {/* Fix (auditoría transversal 2026-07-25, item 7): insuredClaimReady
                arranca en `false` (fail-closed, ver arriba) y puede pasar a `true`
                después del mount cuando /api/public/insured-status responde --
                hero.description vs hero.descriptionInsured difieren en longitud
                en los 3 locales (p.ej. fr agrega ", assurée" ~6 caracteres; zh
                agrega "认证、投保并" ~4 caracteres), lo suficiente para cambiar el
                número de líneas cerca de un punto de wrap y producir un salto de
                layout real cuando el fetch resuelve después del primer pintado.
                Se reserva min-h-[4.9em] (~3 líneas a leading-relaxed, en unidades
                em que escalan con text-lg/md:text-xl) para el peor caso de las 6
                variantes (3 locales x 2 estados) sin tocar la lógica fail-closed
                de insuredClaimReady. */}
            <p className="text-lg md:text-xl text-gray-600 mb-8 leading-relaxed min-h-[4.9em]">
              {t(insuredClaimReady ? 'hero.descriptionInsured' : 'hero.description')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <QuoteButton variant="primary">{t('hero.ctaPrimary')}</QuoteButton>
              <p className="text-sm text-gray-500 flex items-center">
                <Clock className="w-4 h-4 mr-2" />
                {t('hero.timeEstimate')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Signals */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-brand-ice p-6 rounded-lg">
              <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center mb-4 shadow-elevation-1">
                <Shield className="w-6 h-6 text-brand-navy" />
              </div>
              <h3 className="text-lg font-semibold text-brand-ink mb-2">{t(insuredClaimReady ? 'trust.verifiedTitleInsured' : 'trust.verifiedTitle')}</h3>
              <p className="text-gray-600 text-sm">{t(insuredClaimReady ? 'trust.verifiedDescInsured' : 'trust.verifiedDesc')}</p>
            </div>
            <div className="bg-brand-ice p-6 rounded-lg">
              <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center mb-4 shadow-elevation-1">
                <Users className="w-6 h-6 text-brand-navy" />
              </div>
              <h3 className="text-lg font-semibold text-brand-ink mb-2">{t('trust.teamTitle')}</h3>
              <p className="text-gray-600 text-sm">{t('trust.teamDesc')}</p>
            </div>
            <div className="bg-brand-ice p-6 rounded-lg">
              <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center mb-4 shadow-elevation-1">
                <Star className="w-6 h-6 text-brand-navy" />
              </div>
              <h3 className="text-lg font-semibold text-brand-ink mb-2">{t('trust.guaranteeTitle')}</h3>
              <p className="text-gray-600 text-sm">{t('trust.guaranteeDesc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-brand-ice">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-brand-ink mb-4">
            {t('cta.title')}
          </h2>
          <p className="text-gray-600 mb-8 text-lg">
            {t('cta.description')}
          </p>
          <QuoteButton variant="secondary">{t('hero.ctaSecondary')}</QuoteButton>
        </div>
      </section>

      {/* Footer — claro con línea divisoria, no bloque oscuro */}
      <footer className="bg-white text-gray-500 py-8 border-t border-brand-ice">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Ship className="w-5 h-5 text-brand-navy" />
            <span className="text-brand-ink font-semibold">Lulu Island Flagship</span>
          </div>
          <p className="text-sm">
            {t('footer.copyright')}
          </p>
          {/* Enlaces legales (términos, privacidad, cancelación) -- páginas
              públicas nuevas, contenido fiel a las reglas reales de
              src/lib/order-cancellation.ts y src/lib/pipeda.ts. */}
          <nav className="flex items-center gap-4 text-xs text-gray-400">
            <a href={`/${locale}/terms`} className="hover:text-gray-600 transition-colors">
              {t('legal.nav.terms')}
            </a>
            <a href={`/${locale}/privacy`} className="hover:text-gray-600 transition-colors">
              {t('legal.nav.privacy')}
            </a>
            <a href={`/${locale}/cancellation`} className="hover:text-gray-600 transition-colors">
              {t('legal.nav.cancellation')}
            </a>
          </nav>
          {/* v8.3: enlace discreto al Portal de equipo (empleado, coordinador,
              QC, manager) -- deliberadamente en el footer, no en el hero, para
              no confundir a clientes potenciales con acceso de staff. */}
          <a
            href={`/${locale}/portal`}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {t('nav.teamPortal')}
          </a>
          {/* Nuevo: enlace público al formulario de aplicación del flujo de
              contratación (src/app/[locale]/empleo/page.tsx). Deliberadamente
              junto al link de Portal de equipo -- mismo estilo visual
              discreto, no compite con el CTA principal de cotización -- pero
              va dirigido a candidatos externos, no a staff ya contratado, por
              lo que es un link separado con su propio texto. */}
          <a
            href={`/${locale}/jobs`}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {t('footer.workWithUs')}
          </a>
        </div>
      </footer>
    </main>
  );
}
