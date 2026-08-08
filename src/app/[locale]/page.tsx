"use client";

import { Suspense, useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import Image from "next/image";
import Script from "next/script";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Ship,
  MapPin,
  LogIn,
  UserPlus,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Clock,
  FileText,
  HelpCircle,
  ArrowRight,
} from "lucide-react";

import { LanguageSelector } from "@/components/LanguageSelector";
import { AuthModal } from "@/components/cotizador/AuthModal";
import { isAllowedInternalPath } from "@/lib/safe-redirect";
import { supabase } from "@/lib/supabase";

function NextParamAuthGate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathLocale = pathname.match(/^\/(en|zh|fr)(\/|$)/);
  const locale = pathLocale ? pathLocale[1] : "en";
  const nextParam = searchParams.get("next");
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!nextParam || !isAllowedInternalPath(nextParam)) { setChecking(false); return; }
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) { router.replace(nextParam); }
      else { setChecking(false); }
    });
  }, [nextParam, router]);

  if (!nextParam || dismissed || !isAllowedInternalPath(nextParam)) return null;
  if (checking) return null;

  return (
    <AuthModal
      onClose={() => {
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
  const [heroAddress, setHeroAddress] = useState("");

  function handleHeroSubmit() {
    const trimmed = heroAddress.trim();
    if (!trimmed) return;
    router.push(`/${locale}/quote?address=${encodeURIComponent(trimmed)}`);
  }

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

  function getContent(key: string): string {
    if (siteContent[key]) return siteContent[key];
    return t(key);
  }

  const standardIcons = [CheckCircle2, Clock, ShieldCheck, FileText];

  return (
    <main className="min-h-screen bg-white">
      <LocalBusinessSchema />
      <Suspense fallback={null}>
        <NextParamAuthGate />
      </Suspense>

      {authModal && (
        <AuthModal
          signupMode={authModal === "signup"}
          onClose={() => setAuthModal(null)}
          onSuccess={() => {
            if (authModal === "signup") {
              router.push(`/${locale}/account`);
            } else {
              router.push(`/${locale}`);
            }
          }}
          postLoginRedirect={authModal === "signup" ? `/${locale}/account` : `/${locale}`}
        />
      )}

      {/* Sticky Glassmorphism Header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100/80 transition-all shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-navy text-brand-gold flex items-center justify-center shadow-elevation-1">
              <Ship className="w-6 h-6 text-brand-gold" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-brand-ink leading-snug">Lulu Island Flagship</h1>
              <p className="text-xs text-brand-wave-blue font-medium">Residential Home Care</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <span className="flex items-center gap-1.5 text-brand-navy font-medium bg-brand-ice/80 px-3 py-1.5 rounded-full text-xs border border-brand-navy/5">
              <MapPin className="w-3.5 h-3.5 text-brand-wave-blue" />
              {getContent('nav.location')}
            </span>
            <button
              onClick={() => setAuthModal("signin")}
              className="flex items-center gap-1.5 text-brand-navy hover:text-brand-wave-blue transition-colors font-medium"
            >
              <LogIn className="w-4 h-4" />
              {getContent('nav.signIn')}
            </button>
            <button
              onClick={() => setAuthModal("signup")}
              className="flex items-center gap-1.5 bg-brand-navy text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-navy-light transition-all shadow-sm hover:shadow"
            >
              <UserPlus className="w-4 h-4" />
              {getContent('nav.signUp')}
            </button>
            <LanguageSelector />
          </nav>

          <div className="md:hidden flex items-center gap-2">
            <LanguageSelector />
            <button
              onClick={() => router.push(`/${locale}/quote`)}
              className="text-brand-navy hover:text-brand-wave-blue transition-colors text-xs font-semibold px-2 py-1"
            >
              {getContent('nav.getQuote')}
            </button>
            <button
              onClick={() => setAuthModal("signin")}
              aria-label={getContent('nav.signIn')}
              className="flex items-center gap-1 text-brand-navy hover:text-brand-wave-blue transition-colors text-xs p-1"
            >
              <LogIn className="w-4 h-4" />
              <span>{getContent('nav.signIn')}</span>
            </button>
            <button
              onClick={() => setAuthModal("signup")}
              className="flex items-center gap-1 bg-brand-navy text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-brand-navy-light transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{getContent('nav.signUp')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-ice/70 via-white to-white py-20 md:py-28">
        {siteContent["image.hero"] && (
          <div className="absolute inset-0 -z-10">
            <Image src={siteContent["image.hero"]} alt="" fill className="object-cover" priority />
            <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px]" />
          </div>
        )}
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Micro-badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-navy/5 border border-brand-navy/10 text-xs font-semibold text-brand-navy mb-6 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-brand-gold-dark" />
            <span>Residential Home Care · Richmond & Vancouver</span>
          </div>

          <h1 className="text-3xl md:text-5xl font-bold text-brand-ink mb-3 font-[family-name:var(--font-playfair)] leading-tight tracking-tight">
            {getContent('hero.title')}
          </h1>
          <p className="text-sm md:text-base font-semibold text-brand-wave-blue mb-8 tracking-wide">
            {getContent('hero.subtitle')}
          </p>

          <p className="text-base md:text-lg text-gray-700 mb-10 max-w-2xl mx-auto leading-relaxed whitespace-pre-line font-normal">
            {getContent('hero.proposition')}
          </p>

          {/* Hero Command Bar */}
          <div className="bg-white/90 backdrop-blur-sm p-2 md:p-2.5 rounded-2xl border border-gray-200/80 shadow-elevation-2 flex flex-col sm:flex-row gap-2 max-w-xl mx-auto transition-all hover:shadow-elevation-3">
            <div className="relative flex-1 flex items-center">
              <MapPin className="w-5 h-5 text-brand-wave-blue absolute left-3.5" />
              <input
                type="text"
                value={heroAddress}
                onChange={(e) => setHeroAddress(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleHeroSubmit(); }}
                placeholder={getContent('hero.placeholder')}
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-transparent text-brand-ink bg-transparent focus:outline-none text-sm font-medium placeholder:text-gray-400"
              />
            </div>
            <button
              type="button"
              onClick={handleHeroSubmit}
              disabled={!heroAddress.trim()}
              className="px-6 py-3.5 bg-brand-navy text-white rounded-xl font-semibold hover:bg-brand-navy-light transition-all shadow-sm hover:shadow flex items-center justify-center gap-2 text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{getContent('hero.cta')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-brand-wave-blue mt-4 font-medium">
            {getContent('hero.hint')}
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-white border-t border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-bold text-brand-wave-blue uppercase tracking-widest mb-2">
              {getContent('how.title')}
            </p>
            <div className="w-12 h-1 bg-brand-gold mx-auto rounded-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((stepNum) => (
              <div
                key={stepNum}
                className="bg-white rounded-2xl p-6 border border-gray-100 shadow-elevation-1 hover:shadow-elevation-2 hover:-translate-y-0.5 transition-all duration-300 flex items-start gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-navy text-brand-gold flex items-center justify-center font-bold text-base shrink-0 shadow-sm">
                  {stepNum}
                </div>
                <p className="text-sm md:text-base text-brand-ink leading-relaxed font-medium mt-1">
                  {getContent(`how.step${stepNum}`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Image divider 1 */}
      {siteContent["image.divider1"] && (
        <div className="relative w-full h-[320px] shadow-inner">
          <Image src={siteContent["image.divider1"]} alt="" fill className="object-cover" />
          <div className="absolute inset-0 bg-brand-navy/10" />
        </div>
      )}

      {/* What's Included / Not / Breaks */}
      <section className="py-20 bg-brand-ice/60 border-t border-b border-gray-200/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Included */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 border-t-4 border-t-state-success shadow-elevation-1 hover:shadow-elevation-2 transition-all space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-state-success shrink-0" />
                <h3 className="font-bold text-xs text-brand-navy uppercase tracking-wider">{getContent('included.title')}</h3>
              </div>
              <p className="text-sm text-brand-ink leading-relaxed whitespace-pre-line font-medium text-gray-700">
                {getContent('included.body')}
              </p>
            </div>

            {/* Not Included */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 border-t-4 border-t-state-warning shadow-elevation-1 hover:shadow-elevation-2 transition-all space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-state-warning shrink-0" />
                <h3 className="font-bold text-xs text-brand-navy uppercase tracking-wider">{getContent('not_included.title')}</h3>
              </div>
              <p className="text-sm text-brand-ink leading-relaxed whitespace-pre-line font-medium text-gray-700">
                {getContent('not_included.body')}
              </p>
            </div>

            {/* Breaks */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 border-t-4 border-t-brand-navy shadow-elevation-1 hover:shadow-elevation-2 transition-all space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-brand-navy shrink-0" />
                <h3 className="font-bold text-xs text-brand-navy uppercase tracking-wider">{getContent('breaks.title')}</h3>
              </div>
              <p className="text-sm text-brand-ink leading-relaxed whitespace-pre-line font-medium text-gray-700">
                {getContent('breaks.body')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Our Standards */}
      <section className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-bold text-brand-wave-blue uppercase tracking-widest mb-2">
              {getContent('standards.title')}
            </p>
            <div className="w-12 h-1 bg-brand-gold mx-auto rounded-full" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => {
              const Icon = standardIcons[i - 1] || ShieldCheck;
              return (
                <div
                  key={i}
                  className="bg-white rounded-2xl p-6 border border-gray-100 shadow-elevation-1 hover:shadow-elevation-2 hover:-translate-y-0.5 transition-all space-y-3"
                >
                  <div className="w-10 h-10 rounded-xl bg-brand-ice text-brand-navy flex items-center justify-center">
                    <Icon className="w-5 h-5 text-brand-navy" />
                  </div>
                  <h4 className="text-base font-bold text-brand-ink">
                    {getContent(`standards.${i}.title`)}
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed font-normal">
                    {getContent(`standards.${i}.body`)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Image divider 2 */}
      {siteContent["image.divider2"] && (
        <div className="relative w-full h-[320px] shadow-inner">
          <Image src={siteContent["image.divider2"]} alt="" fill className="object-cover" />
          <div className="absolute inset-0 bg-brand-navy/10" />
        </div>
      )}

      {/* FAQ */}
      <section className="py-20 bg-brand-ice/60 border-t border-gray-200/60">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-bold text-brand-navy uppercase tracking-widest mb-2">
              {getContent('faq.title')}
            </p>
            <div className="w-12 h-1 bg-brand-gold mx-auto rounded-full" />
          </div>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="bg-white rounded-2xl p-6 border border-gray-100 shadow-elevation-1 hover:shadow-elevation-2 transition-all"
              >
                <div className="flex items-start gap-3">
                  <HelpCircle className="w-5 h-5 text-brand-wave-blue shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-base font-bold text-brand-ink mb-2">
                      {getContent(`faq.q${i}`)}
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed font-normal">
                      {getContent(`faq.a${i}`)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white text-gray-500 py-10 border-t border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-navy text-brand-gold flex items-center justify-center shadow-sm">
              <Ship className="w-5 h-5 text-brand-gold" />
            </div>
            <div>
              <span className="text-brand-ink font-bold text-sm block">Lulu Island Flagship</span>
              <p className="text-xs text-brand-wave-blue font-medium">Residential Home Care</p>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            {getContent('footer.copyright')}
          </p>
          <nav className="flex items-center gap-4 text-xs text-gray-500 font-medium">
            <a href={`/${locale}/terms`} className="hover:text-brand-navy transition-colors">
              {getContent('legal.nav.terms')}
            </a>
            <a href={`/${locale}/privacy`} className="hover:text-brand-navy transition-colors">
              {getContent('legal.nav.privacy')}
            </a>
            <a href={`/${locale}/cancellation`} className="hover:text-brand-navy transition-colors">
              {getContent('legal.nav.cancellation')}
            </a>
            <a href={`/${locale}/portal`} className="hover:text-brand-navy transition-colors">
              {getContent('nav.teamPortal')}
            </a>
            <a href={`/${locale}/jobs`} className="hover:text-brand-navy transition-colors">
              {getContent('footer.workWithUs')}
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
