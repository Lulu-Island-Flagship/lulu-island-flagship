"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Search,
  TrendingUp,
  ClipboardList,
  FileSearch,
  Tag,
  ShieldCheck,
  Siren,
  CalendarClock,
  UserMinus,
  DollarSign,
  Star,
  Landmark,
  DatabaseBackup,
  ChevronRight,
  Users,
  Gift,
  Settings2,
  AlertTriangle,
  HeartPulse,
  Video,
  Repeat,
  BadgeCheck,
  LifeBuoy,
  CloudRain,
  FlaskConical,
  Target,
  TrendingDown,
  Sparkles,
  Handshake,
  Wallet,
  Scale,
} from "lucide-react";
import DashboardMetricsPanel from "./DashboardMetricsPanel";
import AutopilotModeBanner from "./AutopilotModeBanner";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { roleAllows, type AdminRole, type AdminResource } from "@/lib/admin-rbac";

type CardType = "kpi" | "action" | "monitoring";

interface DashboardCard {
  title: string;
  description: string;
  icon: typeof TrendingUp;
  href: string;
  color: string;
  resource: AdminResource;
  type: CardType;
  badgeKey?: string;
}

interface ModuleItem {
  label: string;
  href: string;
  resource: AdminResource;
}

interface ModuleGroup {
  title: string;
  items: ModuleItem[];
}

export default function AdminDashboardClient({ roles }: { roles: AdminRole[] }) {
  const t = useTranslations("admin.dashboard");
  const tModules = useTranslations("admin.modules");
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/admin/dashboard-counts", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.counts) setCounts(data.counts);
      })
      .catch(() => {});
  }, []);

  // ── 12 Dashboard Cards ──────────────────────────────────────────────
  const cards: DashboardCard[] = [
    // KPI
    { title: t("cards.businessHealth.title"), description: t("cards.businessHealth.description"), icon: TrendingUp, href: `/${safeLocale}/admin`, color: "bg-emerald-50 text-emerald-600", resource: "services", type: "kpi" },
    // Action
    { title: t("cards.reviewServices.title"), description: t("cards.reviewServices.description"), icon: ClipboardList, href: `/${safeLocale}/admin/servicios`, color: "bg-blue-50 text-blue-600", resource: "services", type: "action", badgeKey: "pendingDispatch" },
    { title: t("cards.reviewQuotes.title"), description: t("cards.reviewQuotes.description"), icon: FileSearch, href: `/${safeLocale}/admin/quotes-review`, color: "bg-rose-50 text-rose-600", resource: "quotes_review", type: "action" },
    { title: t("cards.reviewUpsells.title"), description: t("cards.reviewUpsells.description"), icon: Tag, href: `/${safeLocale}/admin/upsells`, color: "bg-amber-50 text-amber-600", resource: "upsells_review", type: "action" },
    { title: t("cards.approveServices.title"), description: t("cards.approveServices.description"), icon: ShieldCheck, href: `/${safeLocale}/admin/qc`, color: "bg-indigo-50 text-indigo-600", resource: "qc_wall", type: "action" },
    { title: t("cards.reviewAlerts.title"), description: t("cards.reviewAlerts.description"), icon: Siren, href: `/${safeLocale}/admin/alerts`, color: "bg-red-50 text-red-600", resource: "risk_assessments", type: "action", badgeKey: "activeAlerts" },
    { title: t("cards.todaysDispatch.title"), description: t("cards.todaysDispatch.description"), icon: CalendarClock, href: `/${safeLocale}/admin/dispatch`, color: "bg-teal-50 text-teal-600", resource: "dispatch", type: "action" },
    // KPI
    { title: t("cards.atRiskClients.title"), description: t("cards.atRiskClients.description"), icon: UserMinus, href: `/${safeLocale}/admin/churn-signals`, color: "bg-orange-50 text-orange-600", resource: "services", type: "kpi" },
    { title: t("cards.netMargin.title"), description: t("cards.netMargin.description"), icon: DollarSign, href: `/${safeLocale}/admin/contabilidad`, color: "bg-green-50 text-green-600", resource: "finance", type: "kpi" },
    { title: t("cards.teamScore.title"), description: t("cards.teamScore.description"), icon: Star, href: `/${safeLocale}/admin/team-ranking`, color: "bg-yellow-50 text-yellow-600", resource: "teams", type: "kpi" },
    // Monitoring
    { title: t("cards.craDeadlines.title"), description: t("cards.craDeadlines.description"), icon: Landmark, href: `/${safeLocale}/admin/cra-remittances`, color: "bg-slate-50 text-slate-600", resource: "finance", type: "monitoring" },
    { title: t("cards.backupStatus.title"), description: t("cards.backupStatus.description"), icon: DatabaseBackup, href: `/${safeLocale}/admin/backups`, color: "bg-gray-50 text-gray-600", resource: "finance", type: "monitoring" },
  ];

  // ── Module Sidebar ──────────────────────────────────────────────────
  const modules: ModuleGroup[] = [
    { title: tModules("people.title"), items: [
      { label: tModules("people.items.employees"), href: `/${safeLocale}/admin/empleados`, resource: "employees_admin" as AdminResource },
      { label: tModules("people.items.applicants"), href: `/${safeLocale}/admin/applicants`, resource: "applicants" as AdminResource },
      { label: tModules("people.items.teams"), href: `/${safeLocale}/admin/teams`, resource: "teams" as AdminResource },
      { label: tModules("people.items.teamRotation"), href: `/${safeLocale}/admin/coworker-rotation`, resource: "teams" as AdminResource },
      { label: tModules("people.items.certifications"), href: `/${safeLocale}/admin/certificaciones`, resource: "services" as AdminResource },
      { label: tModules("people.items.wellbeing"), href: `/${safeLocale}/admin/wellbeing`, resource: "wellbeing" as AdminResource },
      { label: tModules("people.items.marketing"), href: `/${safeLocale}/admin/employee-marketing`, resource: "upsells_review" as AdminResource },
    ]},
    { title: tModules("clients.title"), items: [
      { label: tModules("clients.items.newClients"), href: `/${safeLocale}/admin/clients`, resource: "clients" as AdminResource },
      { label: tModules("clients.items.segments"), href: `/${safeLocale}/admin/client-segments`, resource: "services" as AdminResource },
      { label: tModules("clients.items.candidatePool"), href: `/${safeLocale}/admin/live-portfolio`, resource: "live_portfolio_publish" as AdminResource },
      { label: tModules("clients.items.campaigns"), href: `/${safeLocale}/admin/seasonal-campaigns`, resource: "upsells_review" as AdminResource },
      { label: tModules("clients.items.gifts"), href: `/${safeLocale}/admin/regalos`, resource: "upsells_review" as AdminResource },
      { label: tModules("clients.items.neighborhood"), href: `/${safeLocale}/admin/neighborhood`, resource: "services" as AdminResource },
    ]},
    { title: tModules("finance.title"), items: [
      { label: tModules("finance.items.contributionMargin"), href: `/${safeLocale}/admin/contabilidad`, resource: "finance" as AdminResource },
      { label: tModules("finance.items.pricingRules"), href: `/${safeLocale}/admin/pricing-rules`, resource: "pricing_rules" as AdminResource },
      { label: tModules("finance.items.pricingSettings"), href: `/${safeLocale}/admin/pricing-settings`, resource: "pricing_settings" as AdminResource },
      { label: tModules("finance.items.payrollExport"), href: `/${safeLocale}/admin/nomina`, resource: "payroll" as AdminResource },
      { label: tModules("finance.items.insurance"), href: `/${safeLocale}/admin/business-insurance`, resource: "finance" as AdminResource },
      { label: tModules("finance.items.economicSettings"), href: `/${safeLocale}/admin/parametros-economicos`, resource: "finance" as AdminResource },
      { label: tModules("finance.items.partners"), href: `/${safeLocale}/admin/partners`, resource: "services" as AdminResource },
      { label: tModules("finance.items.paymentSuccess"), href: `/${safeLocale}/admin/contabilidad`, resource: "finance" as AdminResource },
    ]},
    { title: tModules("compliance.title"), items: [
      { label: tModules("compliance.items.laborCompliance"), href: `/${safeLocale}/admin/cumplimiento-laboral`, resource: "compliance" as AdminResource },
      { label: tModules("compliance.items.privacy"), href: `/${safeLocale}/admin/pipeda`, resource: "compliance" as AdminResource },
      { label: tModules("compliance.items.contractRenewals"), href: `/${safeLocale}/admin/contract-reviews`, resource: "compliance" as AdminResource },
      { label: tModules("compliance.items.legalUpdates"), href: `/${safeLocale}/admin/monitoreo-legal`, resource: "compliance" as AdminResource },
      { label: tModules("compliance.items.incidents"), href: `/${safeLocale}/admin/workplace-incidents`, resource: "near_misses" as AdminResource },
    ]},
    { title: tModules("system.title"), items: [
      { label: tModules("system.items.recoveryDrills"), href: `/${safeLocale}/admin/dr-drill`, resource: "services" as AdminResource },
      { label: tModules("system.items.stressTest"), href: `/${safeLocale}/admin/stress-scenario`, resource: "services" as AdminResource },
      { label: tModules("system.items.migrationClosure"), href: `/${safeLocale}/admin/legacy-migration`, resource: "services" as AdminResource },
      { label: tModules("system.items.experiments"), href: `/${safeLocale}/admin/experiments`, resource: "services" as AdminResource },
      { label: tModules("system.items.localSeo"), href: `/${safeLocale}/admin/seo-local`, resource: "services" as AdminResource },
      { label: tModules("system.items.growthMetrics"), href: `/${safeLocale}/admin/growth-metrics`, resource: "services" as AdminResource },
      { label: tModules("system.items.attribution"), href: `/${safeLocale}/admin/attribution`, resource: "services" as AdminResource },
    ]},
  ];

  const visibleCards = cards.filter((card) => roleAllows(roles, card.resource));

  // ── Search filter ───────────────────────────────────────────────────
  const query = search.trim().toLowerCase();
  const filteredCards = query
    ? visibleCards.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.description.toLowerCase().includes(query)
      )
    : visibleCards;

  const kpiCards = filteredCards.filter((c) => c.type === "kpi");
  const actionCards = filteredCards.filter((c) => c.type === "action");
  const monitoringCards = filteredCards.filter((c) => c.type === "monitoring");

  function renderCard(card: DashboardCard) {
    const Icon = card.icon;
    return (
      <Link
        key={card.title}
        href={card.href}
        className="bg-white rounded-xl border p-5 text-left hover:shadow-md transition-shadow group block"
      >
        <div className="flex items-start justify-between">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.color}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex items-center gap-2">
            {card.badgeKey && counts[card.badgeKey] > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-red-500 text-white">
                {counts[card.badgeKey]}
              </span>
            )}
            <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand-navy transition-colors" />
          </div>
        </div>
        <h2 className="mt-3 font-semibold text-brand-ink">{card.title}</h2>
        <p className="mt-1 text-sm text-gray-500">{card.description}</p>
      </Link>
    );
  }

  return (
    <ErrorBoundary>
    <div className="max-w-6xl mx-auto px-4 py-8">
      <AutopilotModeBanner locale={safeLocale} />
      {roleAllows(roles, "finance") && <DashboardMetricsPanel />}

      <div className="flex gap-8">
        {/* ── Main Content ─────────────────────────────────────────── */}
        <div className="flex-1 space-y-6">
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchAriaLabel")}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 focus:border-brand-wave-blue focus:ring-2 focus:ring-brand-wave-blue/20 outline-none text-sm"
            />
          </div>

          {filteredCards.length === 0 ? (
            <p className="text-sm text-gray-500">{t("searchNoResults")}</p>
          ) : (
            <>
              {/* KPI Row */}
              {kpiCards.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    {t("sections.kpi")}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {kpiCards.map(renderCard)}
                  </div>
                </section>
              )}

              {/* Action Row */}
              {actionCards.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    {t("sections.actions")}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {actionCards.map(renderCard)}
                  </div>
                </section>
              )}

              {/* Monitoring Row */}
              {monitoringCards.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    {t("sections.monitoring")}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {monitoringCards.map(renderCard)}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* ── Sidebar ────────────────────────────────────────────────── */}
        <aside className="hidden lg:block w-60 space-y-1 shrink-0">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mb-2">
            {t("sections.modules")}
          </h2>
          {modules.map((mod) => (
            <details key={mod.title} className="group/module">
              <summary className="cursor-pointer select-none text-sm font-medium text-brand-ink hover:text-brand-navy px-2 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-1.5">
                <ChevronRight className="w-3.5 h-3.5 text-gray-400 transition-transform group-open/module:rotate-90 shrink-0" />
                {mod.title}
              </summary>
              <div className="ml-5 mt-1 space-y-0.5">
                {mod.items
                  .filter((item) => roleAllows(roles, item.resource))
                  .map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      className="block text-sm text-gray-500 hover:text-brand-navy hover:bg-gray-50 px-2 py-1 rounded-lg transition-colors"
                    >
                      {item.label}
                    </Link>
                  ))}
              </div>
            </details>
          ))}
        </aside>
      </div>
    </div>
    </ErrorBoundary>
  );
}
