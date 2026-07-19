"use client";

import React from "react";
import {
  ClipboardList,
  Users,
  Tag,
  ListChecks,
  ChevronRight,
  AlertTriangle,
  ShieldCheck,
  ClipboardCheck,
  Settings2,
  DollarSign,
  FileSearch,
  CalendarClock,
  Sparkles,
  LifeBuoy,
  CloudRain,
  HeartPulse,
  UserMinus,
  Siren,
  TrendingUp,
  Handshake,
  Home,
  FlaskConical,
  Crown,
  Moon,
  Repeat,
  Images,
  MapPin,
  Video,
  Wallet,
  Scale,
  ShieldAlert,
  Gift,
  Target,
  StickyNote,
  TrendingDown,
  Archive,
  BadgeCheck,
  Landmark,
  DatabaseBackup,
  FileSignature,
  CalendarDays,
} from "lucide-react";
import DashboardMetricsPanel from "./DashboardMetricsPanel";
import AutopilotModeBanner from "./AutopilotModeBanner";

export default function AdminDashboardClient() {
  // Detect locale from pathname for navigation
  const locale = (typeof window !== "undefined" 
    ? window.location.pathname.split("/")[1] 
    : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const cards = [
    {
      title: "Alert Inbox",
      description: "Unified queue — respond in 10 min vs. can wait (E0.6)",
      icon: Siren,
      href: `/${safeLocale}/admin/alerts`,
      color: "bg-red-50 text-red-600",
    },
    {
      title: "Today's Services",
      description: "View all scheduled services for today with checklist progress",
      icon: ClipboardList,
      href: `/${safeLocale}/admin/servicios`,
      color: "bg-blue-50 text-blue-600",
    },
    {
      title: "Dispatch review",
      description: "Daily assignment matrix — override, language match, workday alerts (D.4)",
      icon: CalendarClock,
      href: `/${safeLocale}/admin/dispatch`,
      color: "bg-teal-50 text-teal-600",
    },
    {
      title: "Employees",
      description: "View all active and inactive employees",
      icon: Users,
      href: `/${safeLocale}/admin/empleados`,
      color: "bg-purple-50 text-purple-600",
    },
    {
      title: "Upsells Review",
      description: "Review upsells proposed by employees",
      icon: Tag,
      href: `/${safeLocale}/admin/upsells`,
      color: "bg-amber-50 text-amber-600",
    },
    {
      title: "Checklists",
      description: "Manage SOP checklist templates by zone and service type",
      icon: ListChecks,
      href: `/${safeLocale}/admin/checklists`,
      color: "bg-green-50 text-green-600",
    },
    {
      title: "QC Wall",
      description: "Approve or reject completed services with evidence",
      icon: ShieldCheck,
      href: `/${safeLocale}/admin/qc`,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      title: "Field Audits",
      description: "Register field evaluations and view peer vote aggregates",
      icon: ClipboardCheck,
      href: `/${safeLocale}/admin/audits`,
      color: "bg-cyan-50 text-cyan-600",
    },
    {
      title: "Tickets",
      description: "Disputes, discrepancies, and consultation queue",
      icon: AlertTriangle,
      href: `/${safeLocale}/admin/tickets`,
      color: "bg-red-50 text-red-600",
    },
    {
      title: "Quote Reviews",
      description: "Approve or reject quotes below the 15% margin floor",
      icon: FileSearch,
      href: `/${safeLocale}/admin/quotes-review`,
      color: "bg-rose-50 text-rose-600",
    },
    {
      title: "Pricing Rules",
      description: "Headless rule engine — active rules and audit log",
      icon: Settings2,
      href: `/${safeLocale}/admin/pricing-rules`,
      color: "bg-slate-50 text-slate-600",
    },
    {
      title: "Pricing Settings",
      description: "Target hourly rate and HHE table preview",
      icon: DollarSign,
      href: `/${safeLocale}/admin/pricing-settings`,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      title: "Business Insurance",
      description: "Vehicular, general liability, and E&O policy registry",
      icon: ShieldCheck,
      href: `/${safeLocale}/admin/business-insurance`,
      color: "bg-teal-50 text-teal-600",
    },
    {
      title: "Seasonal Campaigns",
      description: "The 5 pre-loaded campaigns, modulated by real demand signals",
      icon: Sparkles,
      href: `/${safeLocale}/admin/seasonal-campaigns`,
      color: "bg-fuchsia-50 text-fuchsia-600",
    },
    {
      title: "Succession Mode",
      description: "Trusted successors and burnout/succession status",
      icon: Users,
      href: `/${safeLocale}/admin/succession`,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      title: "DR Drills",
      description: "Disaster recovery drill log — restore, succession, kit, fallback (E11.4)",
      icon: LifeBuoy,
      href: `/${safeLocale}/admin/dr-drill`,
      color: "bg-orange-50 text-orange-600",
    },
    {
      title: "Weather Exceptions",
      description: "Adverse weather log — reschedule vs. safe abort + Day Rate (D.10#10)",
      icon: CloudRain,
      href: `/${safeLocale}/admin/weather-exceptions`,
      color: "bg-sky-50 text-sky-600",
    },
    {
      title: "Workplace Incidents",
      description: "Injuries — WorkSafeBC 72h pre-filled report countdown (D.10#6)",
      icon: HeartPulse,
      href: `/${safeLocale}/admin/workplace-incidents`,
      color: "bg-rose-50 text-rose-600",
    },
    {
      title: "Churn Signals",
      description: "At-risk clients — survey, reactivation discount, personal follow-up (D.10.9)",
      icon: UserMinus,
      href: `/${safeLocale}/admin/churn-signals`,
      color: "bg-amber-50 text-amber-600",
    },
    {
      title: "Attribution",
      description: "CAC/LTV by channel + suggested budget allocation (D.10.2)",
      icon: TrendingUp,
      href: `/${safeLocale}/admin/attribution`,
      color: "bg-lime-50 text-lime-600",
    },
    {
      title: "Partners & Commissions",
      description: "Real estate, property manager, vet, builder referrals — all T4A (D.10.6)",
      icon: Handshake,
      href: `/${safeLocale}/admin/partners`,
      color: "bg-cyan-50 text-cyan-700",
    },
    {
      title: "Neighborhood",
      description: "Concierge notices, noise rules, complaints, and neighbor leads (E11.5)",
      icon: Home,
      href: `/${safeLocale}/admin/neighborhood`,
      color: "bg-violet-50 text-violet-600",
    },
    {
      title: "A/B Experiments",
      description: "Price/copy/UI experiments — recurring clients always protected (D.10.11)",
      icon: FlaskConical,
      href: `/${safeLocale}/admin/experiments`,
      color: "bg-fuchsia-50 text-fuchsia-700",
    },
    {
      title: "Client Segments",
      description: "VIP / Regular / Sporadic / At Risk / New (E5.14)",
      icon: Crown,
      href: `/${safeLocale}/admin/client-segments`,
      color: "bg-amber-50 text-amber-700",
    },
    {
      title: "Team Wellbeing",
      description: "Aggregated sleep/mood check-ins — never individual (E8.1/E8.3)",
      icon: Moon,
      href: `/${safeLocale}/admin/wellbeing`,
      color: "bg-blue-50 text-blue-700",
    },
    {
      title: "Teams",
      description: "Minimal team identity (name + avatar) feeding the weekly Top-3 ranking (E8.9/E8.10)",
      icon: Users,
      href: `/${safeLocale}/admin/teams`,
      color: "bg-indigo-50 text-indigo-700",
    },
    {
      title: "Route Shortcuts",
      description: "Employee-reported shortcuts pending validation — validating pays $10 (E8 learning route)",
      icon: MapPin,
      href: `/${safeLocale}/admin/route-shortcuts`,
      color: "bg-cyan-50 text-cyan-700",
    },
    {
      title: "Coworker Rotation",
      description: "Minimum 3 distinct coworkers/month + \"never together\" exceptions (E8.14)",
      icon: Repeat,
      href: `/${safeLocale}/admin/coworker-rotation`,
      color: "bg-teal-50 text-teal-700",
    },
    {
      title: "Live Portfolio",
      description: "Auto-surfaced candidates — one-tap approve, client keeps a 24h withdrawal right (E5.15)",
      icon: Images,
      href: `/${safeLocale}/admin/live-portfolio`,
      color: "bg-rose-50 text-rose-700",
    },
    {
      title: "SEO Local & GBP",
      description: "Checklist Google Business Profile + verificación NAP trimestral (E10.3)",
      icon: MapPin,
      href: `/${safeLocale}/admin/seo-local`,
      color: "bg-lime-50 text-lime-700",
    },
    {
      title: "Employee Marketing",
      description: "Day-in-the-life reels & badge showcase — employee consent + one-touch approval (E10.8)",
      icon: Video,
      href: `/${safeLocale}/admin/employee-marketing`,
      color: "bg-violet-50 text-violet-700",
    },
    {
      title: "Payroll Export",
      description: "CPP/EI/WorkSafeBC/Vacation Pay per employee, CSV/JSON export (E9.3)",
      icon: Wallet,
      href: `/${safeLocale}/admin/nomina`,
      color: "bg-emerald-50 text-emerald-700",
    },
    {
      title: "Economic Parameters",
      description: "Minimum wage / Day Rate — simulate impact, one click to apply (E9.6)",
      icon: DollarSign,
      href: `/${safeLocale}/admin/parametros-economicos`,
      color: "bg-amber-50 text-amber-700",
    },
    {
      title: "Legal Monitoring",
      description: "7 regulatory feeds, blind-feed alert, open change alerts (E9.7)",
      icon: Scale,
      href: `/${safeLocale}/admin/monitoreo-legal`,
      color: "bg-slate-50 text-slate-700",
    },
    {
      title: "PIPEDA Compliance",
      description: "Data subject requests (48h) + breach protocol (72h) (E9.9)",
      icon: ShieldAlert,
      href: `/${safeLocale}/admin/pipeda`,
      color: "bg-red-50 text-red-700",
    },
    {
      title: "Gift Program",
      description: "Residential retention gifts + property-manager building benefits (E9.11)",
      icon: Gift,
      href: `/${safeLocale}/admin/regalos`,
      color: "bg-pink-50 text-pink-700",
    },
    {
      title: "Growth Metrics",
      description: "Funnel, referrals, churn, NPS scorecard vs. targets (E10.13)",
      icon: Target,
      href: `/${safeLocale}/admin/growth-metrics`,
      color: "bg-teal-50 text-teal-800",
    },
    {
      title: "Operational Notes",
      description: "Notes tied to employees/properties, surfaced by context (E11.2)",
      icon: StickyNote,
      href: `/${safeLocale}/admin/entity-notes`,
      color: "bg-yellow-50 text-yellow-700",
    },
    {
      title: "Financial Stress Scenario",
      description: "-30% revenue × 3 months simulation, levers in order, review threshold (E11.7)",
      icon: TrendingDown,
      href: `/${safeLocale}/admin/stress-scenario`,
      color: "bg-red-50 text-red-800",
    },
    {
      title: "Legacy Migration Closure",
      description: "www redirect + Godaddy archive/cancellation checklist (E11.8)",
      icon: Archive,
      href: `/${safeLocale}/admin/legacy-migration`,
      color: "bg-gray-100 text-gray-700",
    },
    {
      title: "Certifications",
      description: "Chemical handling levels with real expiry — blocks dispatch when lapsed (E9.4)",
      icon: BadgeCheck,
      href: `/${safeLocale}/admin/certificaciones`,
      color: "bg-indigo-50 text-indigo-800",
    },
    {
      title: "CRA Remittances",
      description: "CPP/EI monthly, GST/PST quarterly, T4 annual — reminder calendar (E9.4)",
      icon: Landmark,
      href: `/${safeLocale}/admin/cra-remittances`,
      color: "bg-emerald-50 text-emerald-800",
    },
    {
      title: "Backup Status",
      description: "Transactions/payroll/clients/photos CSV+hash + pg_dump reminder (E9.10)",
      icon: DatabaseBackup,
      href: `/${safeLocale}/admin/backups`,
      color: "bg-slate-50 text-slate-800",
    },
    {
      title: "Contract Renewal Reviews",
      description: "60 days before anniversary — legal diff, approval, digital signature (E9.8)",
      icon: FileSignature,
      href: `/${safeLocale}/admin/contract-reviews`,
      color: "bg-cyan-50 text-cyan-800",
    },
    {
      title: "BC Labor Compliance",
      description: "Documented breaks, sick leave, weekly 32h rest, statutory holiday pay",
      icon: CalendarDays,
      href: `/${safeLocale}/admin/cumplimiento-laboral`,
      color: "bg-orange-50 text-orange-800",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-ink">Admin Dashboard</h1>

      <AutopilotModeBanner locale={safeLocale} />

      <DashboardMetricsPanel />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <a
              key={card.title}
              href={card.href}
              className="bg-white rounded-xl border p-5 text-left hover:shadow-md transition-shadow group block"
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand-navy transition-colors" />
              </div>
              <h2 className="mt-3 font-semibold text-brand-ink">{card.title}</h2>
              <p className="mt-1 text-sm text-gray-500">{card.description}</p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
