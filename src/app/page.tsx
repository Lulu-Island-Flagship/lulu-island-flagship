import { Ship, Shield, Users, Clock, Star, MapPin } from "lucide-react";
import { QuoteButton } from "@/components/landing/QuoteButton";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Ship className="w-8 h-8 text-brand-gold" />
            <div>
              <h1 className="text-lg font-bold tracking-tight">Lulu Island Flagship</h1>
              <p className="text-xs text-brand-wave-blue">Cleaning Services</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <span className="flex items-center gap-1 text-brand-gold">
              <MapPin className="w-4 h-4" />
              Richmond, BC
            </span>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-brand-navy text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 right-20 w-64 h-64 rounded-full bg-brand-wave-blue blur-3xl" />
          <div className="absolute bottom-10 left-10 w-48 h-48 rounded-full bg-brand-gold blur-3xl" />
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28 relative">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-brand-gold/20 text-brand-gold px-4 py-1.5 rounded-full text-sm font-medium mb-6">
              <Star className="w-4 h-4 fill-brand-gold" />
              Serving Richmond & Metro Vancouver
            </div>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              The same trusted team,{" "}
              <span className="text-brand-gold">every time.</span>
            </h2>
            <p className="text-lg md:text-xl text-gray-300 mb-8 leading-relaxed">
              Verified, insured, and trained to care for your home — not just clean it. 
              Full price from quote, no surprises.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <QuoteButton variant="primary">Get Your Quote</QuoteButton>
              <p className="text-sm text-gray-400 flex items-center">
                <Clock className="w-4 h-4 mr-2" />
                Takes less than 90 seconds
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Signals */}
      <section className="py-16 bg-brand-ice">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-6 rounded-lg shadow-elevation-1">
              <div className="w-12 h-12 bg-brand-navy/10 rounded-lg flex items-center justify-center mb-4">
                <Shield className="w-6 h-6 text-brand-navy" />
              </div>
              <h3 className="text-lg font-semibold text-brand-ink mb-2">Verified & Insured</h3>
              <p className="text-gray-600 text-sm">
                Every team member is background-checked, bonded, and covered by comprehensive insurance.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-elevation-1">
              <div className="w-12 h-12 bg-brand-navy/10 rounded-lg flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-brand-navy" />
              </div>
              <h3 className="text-lg font-semibold text-brand-ink mb-2">Same Team, Always</h3>
              <p className="text-gray-600 text-sm">
                No strangers. The same dedicated team returns to your home, knowing your preferences.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-elevation-1">
              <div className="w-12 h-12 bg-brand-navy/10 rounded-lg flex items-center justify-center mb-4">
                <Star className="w-6 h-6 text-brand-navy" />
              </div>
              <h3 className="text-lg font-semibold text-brand-ink mb-2">Premium Guarantee</h3>
              <p className="text-gray-600 text-sm">
                Full price shown upfront. Every service backed by photo evidence and our satisfaction guarantee.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-brand-ink mb-4">
            Ready for a cleaner home?
          </h2>
          <p className="text-gray-600 mb-8 text-lg">
            Get your personalized quote in under 90 seconds. No hidden fees, no surprises.
          </p>
          <QuoteButton variant="secondary">Start Your Quote</QuoteButton>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-brand-ink text-gray-400 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Ship className="w-5 h-5 text-brand-gold" />
            <span className="text-white font-semibold">Lulu Island Flagship</span>
          </div>
          <p className="text-sm">
            © 2026 Lulu Island Flagship Cleaning Services. Richmond, BC, Canada.
          </p>
        </div>
      </footer>
    </main>
  );
}
