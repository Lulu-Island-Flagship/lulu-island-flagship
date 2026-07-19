"use client";

import { useTranslations } from 'next-intl';
import { Ship, Shield, Users, Clock, Star, MapPin } from "lucide-react";
import { QuoteButton } from "@/components/landing/QuoteButton";
import { LanguageSelector } from "@/components/LanguageSelector";

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
    // GET /api/admin/business-insurance -> allThreePoliciesReady). Como este
    // es un componente cliente estático (sin fetch a esa API), el punto de
    // aplicación seguro es NO afirmar la cobertura aquí -- el mismo texto no
    // se puede "bloquear" condicionalmente sin antes cablear un fetch server
    // -> client de allThreePoliciesReady, que es trabajo aparte. Mientras
    // esa condición no exista, la copia no debe mencionar "insured/bonded".
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
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export default function HomePage() {
  const t = useTranslations();

  return (
    <main className="min-h-screen bg-white">
      <LocalBusinessSchema />

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
            <LanguageSelector />
          </nav>
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
            <p className="text-lg md:text-xl text-gray-600 mb-8 leading-relaxed">
              {t('hero.description')}
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
              <h3 className="text-lg font-semibold text-brand-ink mb-2">{t('trust.verifiedTitle')}</h3>
              <p className="text-gray-600 text-sm">{t('trust.verifiedDesc')}</p>
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
        </div>
      </footer>
    </main>
  );
}
