"use client";

import { Suspense, useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import Image from "next/image";
import Script from "next/script";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ship, MapPin, LogIn, UserPlus } from "lucide-react";
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
  const router = useRouter();
  const pathname = usePathname();
  const pathLocale = pathname.match(/^\/(en|zh|fr)(\/|$)/);
  const locale = pathLocale ? pathLocale[1] : "en";


  const [authModal, setAuthModal] = useState<"signin" | "signup" | null>(null);

  // v8.5 Day 7: fetch admin-editable content from site_content table
  const [siteContent, setSiteContent] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetch("/api/content/landing")
      .then((res) => (res.ok ? res.json() : { content: {} }))
      .then((data) => {
        if (!cancelled) setSiteContent(data.content ?? {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Returns admin-edited content if available, falls back to i18n
  function getContent(key: string): string {
    if (siteContent[key]) return siteContent[key];
    return t(key);
  }

  return (
    <main className="min-h-screen bg-white">
      <LocalBusinessSchema />
      <Suspense fallback={null}>
        <NextParamAuthGate />
      </Suspense>

      {/* Fix (auditoría 2026-08-06): los botones de Sign In/Sign Up del header
          llamaban setAuthModal() pero _authModal (con underscore) nunca se
          consumía en el JSX — los botones estaban muertos, cero feedback al
          usuario. Se quita el underscore y se renderiza el AuthModal cuando
          authModal tiene valor. onSuccess redirige a /account (portal unificado
          que ya tiene su propio AuthModal si no hay sesión). */}
      {authModal && (
        <AuthModal
          signupMode={authModal === "signup"}
          onClose={() => setAuthModal(null)}
          onSuccess={() => router.push(`/${locale}/account`)}
          postLoginRedirect={`/${locale}/account`}
        />
      )}

      {/* Header — v8.3 rediseño "Powder Sky": fondo claro, no bloque oscuro */}
      <header className="bg-white border-b border-brand-ice">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Ship className="w-8 h-8 text-brand-navy" />
            <div>
              <h1 className="text-lg font-bold tracking-tight text-brand-ink">Lulu Island Flagship</h1>
              <p className="text-xs text-brand-wave-blue">Residential Home Care</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <span className="flex items-center gap-1 text-brand-navy">
              <MapPin className="w-4 h-4" />
              {getContent('nav.location')}
            </span>
            <button
              onClick={() => setAuthModal("signin")}
              className="flex items-center gap-1 text-brand-navy hover:text-brand-wave-blue transition-colors"
            >
              <LogIn className="w-4 h-4" />
              {getContent('nav.signIn')}
            </button>
            <button
              onClick={() => setAuthModal("signup")}
              className="flex items-center gap-1 bg-brand-navy text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-navy-light transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              {getContent('nav.signUp')}
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
              aria-label={getContent('nav.signIn')}
              className="flex items-center gap-1 text-brand-navy hover:text-brand-wave-blue transition-colors text-sm"
            >
              <LogIn className="w-4 h-4" />
              <span>{getContent('nav.signIn')}</span>
            </button>
            <button
              onClick={() => setAuthModal("signup")}
              className="flex items-center gap-1 bg-brand-navy text-white px-2 py-1 rounded-lg text-xs font-medium hover:bg-brand-navy-light transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{getContent('nav.signUp')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-white py-20 md:py-28">
        {siteContent["image.hero"] && (
          <div className="absolute inset-0 -z-10">
            <Image src={siteContent["image.hero"]} alt="" fill className="object-cover" priority />
            <div className="absolute inset-0 bg-black/30" />
          </div>
        )}
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-brand-ink mb-2">
            {getContent('hero.title')}
          </h1>
          <p className="text-sm text-brand-wave-blue mb-8">
            {getContent('hero.subtitle')}
          </p>
          <p className="text-base md:text-lg text-brand-ink mb-10 max-w-xl mx-auto leading-relaxed whitespace-pre-line">
            {getContent('hero.proposition')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-lg mx-auto">
            <input
              type="text"
              placeholder={getContent('hero.placeholder')}
              className="flex-1 px-4 py-3 border border-brand-ice rounded-md text-brand-ink bg-white 
                         focus:outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy
                         placeholder:text-gray-400"
            />
            <button
              type="button"
              onClick={() => router.push(`/${locale}/quote`)}
              className="px-6 py-3 bg-brand-navy text-white rounded-md font-medium
                         hover:bg-brand-navyLight transition-colors whitespace-nowrap"
            >
              {getContent('hero.cta')}
            </button>
          </div>
          <p className="text-xs text-brand-wave-blue mt-3">
            {getContent('hero.hint')}
          </p>
        </div>
      </section>


      {/* How It Works */}
      <section className="py-16 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs text-brand-wave-blue uppercase tracking-wide mb-8">
            {getContent('how.title')}
          </p>
          <div className="space-y-6">
            <div>
              <span className="text-lg font-bold text-brand-navy">1.</span>
              <p className="text-base text-brand-ink leading-relaxed mt-1">
                {getContent('how.step1')}
              </p>
            </div>
            <div>
              <span className="text-lg font-bold text-brand-navy">2.</span>
              <p className="text-base text-brand-ink leading-relaxed mt-1">
                {getContent('how.step2')}
              </p>
            </div>
            <div>
              <span className="text-lg font-bold text-brand-navy">3.</span>
              <p className="text-base text-brand-ink leading-relaxed mt-1">
                {getContent('how.step3')}
              </p>
            </div>
            <div>
              <span className="text-lg font-bold text-brand-navy">4.</span>
              <p className="text-base text-brand-ink leading-relaxed mt-1">
                {getContent('how.step4')}
              </p>
            </div>
          </div>
        </div>
      </section>


      {/* Image divider 1 — admin-uploaded */}
      {siteContent["image.divider1"] && (
        <div className="relative w-full h-[300px]">
          <Image src={siteContent["image.divider1"]} alt="" fill className="object-cover" />
        </div>
      )}

      {/* Our Standards */}
      <section className="py-16 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs text-brand-wave-blue uppercase tracking-wide mb-8">
            {getContent('standards.title')}
          </p>
          <div className="space-y-6">
            <div>
              <p className="text-base font-bold text-brand-ink">
                {getContent('standards.1.title')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed">
                {getContent('standards.1.body')}
              </p>
            </div>
            <div>
              <p className="text-base font-bold text-brand-ink">
                {getContent('standards.2.title')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed">
                {getContent('standards.2.body')}
              </p>
            </div>
            <div>
              <p className="text-base font-bold text-brand-ink">
                {getContent('standards.3.title')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed">
                {getContent('standards.3.body')}
              </p>
            </div>
            <div>
              <p className="text-base font-bold text-brand-ink">
                {getContent('standards.4.title')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed">
                {getContent('standards.4.body')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What's Included / Not */}
      <section className="py-16 bg-brand-ice">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-8">
            <div>
              <p className="text-xs text-brand-navy uppercase tracking-wide mb-3">
                {getContent('included.title')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed whitespace-pre-line">
                {getContent('included.body')}
              </p>
            </div>
            <div>
              <p className="text-xs text-brand-navy uppercase tracking-wide mb-3">
                {getContent('not_included.title')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed whitespace-pre-line">
                {getContent('not_included.body')}
              </p>
            </div>
            <div>
              <p className="text-xs text-brand-navy uppercase tracking-wide mb-3">
                {getContent('breaks.title')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed whitespace-pre-line">
                {getContent('breaks.body')}
              </p>
            </div>
          </div>
        </div>
      </section>



      {/* Image divider 2 — admin-uploaded */}
      {siteContent["image.divider2"] && (
        <div className="relative w-full h-[300px]">
          <Image src={siteContent["image.divider2"]} alt="" fill className="object-cover" />
        </div>
      )}

      {/* FAQ */}
      <section className="py-16 bg-brand-ice">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs text-brand-navy uppercase tracking-wide mb-8">
            {getContent('faq.title')}
          </p>
          <div className="space-y-6">
            <div>
              <p className="text-base font-bold text-brand-ink mb-2">
                {getContent('faq.q1')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed">
                {getContent('faq.a1')}
              </p>
            </div>
            <div>
              <p className="text-base font-bold text-brand-ink mb-2">
                {getContent('faq.q2')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed">
                {getContent('faq.a2')}
              </p>
            </div>
            <div>
              <p className="text-base font-bold text-brand-ink mb-2">
                {getContent('faq.q3')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed">
                {getContent('faq.a3')}
              </p>
            </div>
            <div>
              <p className="text-base font-bold text-brand-ink mb-2">
                {getContent('faq.q4')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed">
                {getContent('faq.a4')}
              </p>
            </div>
            <div>
              <p className="text-base font-bold text-brand-ink mb-2">
                {getContent('faq.q5')}
              </p>
              <p className="text-base text-brand-ink leading-relaxed">
                {getContent('faq.a5')}
              </p>
            </div>
          </div>
        </div>
      </section>
      {/* CTA Section */}
      <section className="py-16 bg-brand-ice">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-brand-ink mb-4">
            {getContent('cta.title')}
          </h2>
          <p className="text-gray-600 mb-8 text-lg">
            {getContent('cta.description')}
          </p>
          <QuoteButton variant="secondary">{getContent('hero.ctaSecondary')}</QuoteButton>
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
            {getContent('footer.copyright')}
          </p>
          {/* Enlaces legales (términos, privacidad, cancelación) -- páginas
              públicas nuevas, contenido fiel a las reglas reales de
              src/lib/order-cancellation.ts y src/lib/pipeda.ts. */}
          <nav className="flex items-center gap-4 text-xs text-gray-400">
            <a href={`/${locale}/terms`} className="hover:text-gray-600 transition-colors">
              {getContent('legal.nav.terms')}
            </a>
            <a href={`/${locale}/privacy`} className="hover:text-gray-600 transition-colors">
              {getContent('legal.nav.privacy')}
            </a>
            <a href={`/${locale}/cancellation`} className="hover:text-gray-600 transition-colors">
              {getContent('legal.nav.cancellation')}
            </a>
          </nav>
          {/* v8.3: enlace discreto al Portal de equipo (empleado, coordinador,
              QC, manager) -- deliberadamente en el footer, no en el hero, para
              no confundir a clientes potenciales con acceso de staff. */}
          <a
            href={`/${locale}/portal`}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {getContent('nav.teamPortal')}
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
            {getContent('footer.workWithUs')}
          </a>
        </div>
      </footer>
    </main>
  );
}
