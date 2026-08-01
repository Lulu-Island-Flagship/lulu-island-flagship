"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { buildGroups } from "./AdminNav";
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
import { roleAllows, type AdminRole, type AdminResource } from "@/lib/admin-rbac";

// v8.3 fix G-3 (auditoría implacable 2026-07-20b): antes este componente no
// recibía roles ni resource alguno -- las 45 tarjetas se mostraban a
// cualquier cuenta admin, sin importar su rol (un qc_only veía y podía
// navegar a Pricing Rules, Nómina, etc. con solo conocer la URL). Cada
// tarjeta ahora declara su AdminResource real, tomado 1:1 de AdminNav.tsx
// donde el mismo destino ya existía ahí, o del requireAdminRole(...) de su
// propia API cuando no existía un link equivalente en el nav (ver comentario
// por tarjeta más abajo para las que no están en AdminNav.tsx).
export default function AdminDashboardClient({ roles }: { roles: AdminRole[] }) {
  const t = useTranslations("admin.dashboard");
  const tNav = useTranslations("admin.nav");
  // Item 8 (auditoría 2026-07-25): antes se leía el locale con
  // window.location.pathname.split("/")[1], lo que rendería distinto en
  // servidor (SSR, "en" fijo) vs cliente (locale real) -- riesgo de
  // hydration mismatch. useParams() lee el segmento [locale] de la ruta
  // directo del router, sin depender de `window`.
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const cards: Array<{
    title: string;
    description: string;
    icon: typeof Siren;
    href: string;
    color: string;
    resource: AdminResource;
  }> = [
    {
      title: t("cards.alertInbox.title"),
      description: t("cards.alertInbox.description"),
      icon: Siren,
      href: `/${safeLocale}/admin/alerts`,
      color: "bg-red-50 text-red-600",
      // No está en AdminNav.tsx -- API usa "risk_assessments" (src/app/api/admin/alerts/route.ts).
      resource: "risk_assessments",
    },
    {
      title: t("cards.todaysServices.title"),
      description: t("cards.todaysServices.description"),
      icon: ClipboardList,
      href: `/${safeLocale}/admin/servicios`,
      color: "bg-blue-50 text-blue-600",
      resource: "services",
    },
    {
      title: t("cards.dispatchReview.title"),
      description: t("cards.dispatchReview.description"),
      icon: CalendarClock,
      href: `/${safeLocale}/admin/dispatch`,
      color: "bg-teal-50 text-teal-600",
      // No está en AdminNav.tsx -- API usa "dispatch" (src/app/api/admin/dispatch/route.ts).
      resource: "dispatch",
    },
    {
      title: t("cards.employees.title"),
      description: t("cards.employees.description"),
      icon: Users,
      href: `/${safeLocale}/admin/empleados`,
      color: "bg-purple-50 text-purple-600",
      resource: "employees_admin",
    },
    {
      title: t("cards.upsellsReview.title"),
      description: t("cards.upsellsReview.description"),
      icon: Tag,
      href: `/${safeLocale}/admin/upsells`,
      color: "bg-amber-50 text-amber-600",
      resource: "upsells_review",
    },
    {
      title: t("cards.checklists.title"),
      description: t("cards.checklists.description"),
      icon: ListChecks,
      href: `/${safeLocale}/admin/checklists`,
      color: "bg-green-50 text-green-600",
      resource: "checklists_sop",
    },
    {
      title: t("cards.qcWall.title"),
      description: t("cards.qcWall.description"),
      icon: ShieldCheck,
      href: `/${safeLocale}/admin/qc`,
      color: "bg-indigo-50 text-indigo-600",
      resource: "qc_wall",
    },
    {
      title: t("cards.fieldAudits.title"),
      description: t("cards.fieldAudits.description"),
      icon: ClipboardCheck,
      href: `/${safeLocale}/admin/audits`,
      color: "bg-cyan-50 text-cyan-600",
      resource: "field_audits",
    },
    {
      title: t("cards.tickets.title"),
      description: t("cards.tickets.description"),
      icon: AlertTriangle,
      href: `/${safeLocale}/admin/tickets`,
      color: "bg-red-50 text-red-600",
      resource: "tickets",
    },
    {
      title: t("cards.quoteReviews.title"),
      description: t("cards.quoteReviews.description"),
      icon: FileSearch,
      href: `/${safeLocale}/admin/quotes-review`,
      color: "bg-rose-50 text-rose-600",
      resource: "quotes_review",
    },
    {
      title: t("cards.pricingRules.title"),
      description: t("cards.pricingRules.description"),
      icon: Settings2,
      href: `/${safeLocale}/admin/pricing-rules`,
      color: "bg-slate-50 text-slate-600",
      resource: "pricing_rules",
    },
    {
      title: t("cards.pricingSettings.title"),
      description: t("cards.pricingSettings.description"),
      icon: DollarSign,
      href: `/${safeLocale}/admin/pricing-settings`,
      color: "bg-emerald-50 text-emerald-600",
      resource: "pricing_settings",
    },
    {
      title: t("cards.businessInsurance.title"),
      description: t("cards.businessInsurance.description"),
      icon: ShieldCheck,
      href: `/${safeLocale}/admin/business-insurance`,
      color: "bg-teal-50 text-teal-600",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/business-insurance/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.seasonalCampaigns.title"),
      description: t("cards.seasonalCampaigns.description"),
      icon: Sparkles,
      href: `/${safeLocale}/admin/seasonal-campaigns`,
      color: "bg-fuchsia-50 text-fuchsia-600",
      // No está en AdminNav.tsx -- API usa "upsells_review" (src/app/api/admin/seasonal-campaigns/route.ts).
      resource: "upsells_review",
    },
    {
      title: t("cards.succession.title"),
      description: t("cards.succession.description"),
      icon: Users,
      href: `/${safeLocale}/admin/succession`,
      color: "bg-indigo-50 text-indigo-600",
      // No está en AdminNav.tsx -- API usa "employees_admin" (src/app/api/admin/succession/route.ts).
      resource: "employees_admin",
    },
    {
      title: t("cards.drDrills.title"),
      description: t("cards.drDrills.description"),
      icon: LifeBuoy,
      href: `/${safeLocale}/admin/dr-drill`,
      color: "bg-orange-50 text-orange-600",
      // 2026-07-23: también enlazada ahora desde AdminNav.tsx como "Disaster
      // Recovery" (antes apuntaba a /admin/recuperacion-desastres, una página
      // duplicada con menos funcionalidad; se consolidó en esta -- ver
      // comentario en dr-drill/page.tsx). API usa "feature_flags"
      // (src/app/api/admin/dr-drill/route.ts).
      resource: "feature_flags",
    },
    {
      title: t("cards.weatherExceptions.title"),
      description: t("cards.weatherExceptions.description"),
      icon: CloudRain,
      href: `/${safeLocale}/admin/weather-exceptions`,
      color: "bg-sky-50 text-sky-600",
      // No está en AdminNav.tsx -- API usa "risk_assessments" (src/app/api/admin/weather-exceptions/route.ts).
      resource: "risk_assessments",
    },
    {
      title: t("cards.workplaceIncidents.title"),
      description: t("cards.workplaceIncidents.description"),
      icon: HeartPulse,
      href: `/${safeLocale}/admin/workplace-incidents`,
      color: "bg-rose-50 text-rose-600",
      // No está en AdminNav.tsx -- API usa "risk_assessments" (src/app/api/admin/workplace-incidents/route.ts).
      resource: "risk_assessments",
    },
    {
      title: t("cards.churnSignals.title"),
      description: t("cards.churnSignals.description"),
      icon: UserMinus,
      href: `/${safeLocale}/admin/churn-signals`,
      color: "bg-amber-50 text-amber-600",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/churn-signals/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.attribution.title"),
      description: t("cards.attribution.description"),
      icon: TrendingUp,
      href: `/${safeLocale}/admin/attribution`,
      color: "bg-lime-50 text-lime-600",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/attribution/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.partners.title"),
      description: t("cards.partners.description"),
      icon: Handshake,
      href: `/${safeLocale}/admin/partners`,
      color: "bg-cyan-50 text-cyan-700",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/partners/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.neighborhood.title"),
      description: t("cards.neighborhood.description"),
      icon: Home,
      href: `/${safeLocale}/admin/neighborhood`,
      color: "bg-violet-50 text-violet-600",
      // No está en AdminNav.tsx -- API usa "risk_assessments" (src/app/api/admin/neighborhood/route.ts).
      resource: "risk_assessments",
    },
    {
      title: t("cards.experiments.title"),
      description: t("cards.experiments.description"),
      icon: FlaskConical,
      href: `/${safeLocale}/admin/experiments`,
      color: "bg-fuchsia-50 text-fuchsia-700",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/experiments/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.clientSegments.title"),
      description: t("cards.clientSegments.description"),
      icon: Crown,
      href: `/${safeLocale}/admin/client-segments`,
      color: "bg-amber-50 text-amber-700",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/client-segments/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.wellbeing.title"),
      description: t("cards.wellbeing.description"),
      icon: Moon,
      href: `/${safeLocale}/admin/wellbeing`,
      color: "bg-blue-50 text-blue-700",
      resource: "wellbeing",
    },
    {
      title: t("cards.teams.title"),
      description: t("cards.teams.description"),
      icon: Users,
      href: `/${safeLocale}/admin/teams`,
      color: "bg-indigo-50 text-indigo-700",
      resource: "teams",
    },
    {
      title: t("cards.routeShortcuts.title"),
      description: t("cards.routeShortcuts.description"),
      icon: MapPin,
      href: `/${safeLocale}/admin/route-shortcuts`,
      color: "bg-cyan-50 text-cyan-700",
      // No está en AdminNav.tsx -- API usa "wellbeing" (src/app/api/admin/route-shortcuts/route.ts).
      resource: "wellbeing",
    },
    {
      title: t("cards.coworkerRotation.title"),
      description: t("cards.coworkerRotation.description"),
      icon: Repeat,
      href: `/${safeLocale}/admin/coworker-rotation`,
      color: "bg-teal-50 text-teal-700",
      // No está en AdminNav.tsx -- API usa "dispatch" (src/app/api/admin/coworker-rotation/route.ts).
      resource: "dispatch",
    },
    {
      title: t("cards.livePortfolio.title"),
      description: t("cards.livePortfolio.description"),
      icon: Images,
      href: `/${safeLocale}/admin/live-portfolio`,
      color: "bg-rose-50 text-rose-700",
      // Fix (auditoría externa, hallazgo confirmado): esta card usaba
      // "qc_wall" pero la API real (src/app/api/admin/live-portfolio/route.ts
      // y .../[id]/route.ts) exige "live_portfolio_publish" -- un usuario con
      // rol qc_only veía la card (por tener acceso a qc_wall) pero recibía
      // 403 al hacer clic. No está en AdminNav.tsx.
      resource: "live_portfolio_publish",
    },
    {
      title: t("cards.seoLocal.title"),
      description: t("cards.seoLocal.description"),
      icon: MapPin,
      href: `/${safeLocale}/admin/seo-local`,
      color: "bg-lime-50 text-lime-700",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/seo-local/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.employeeMarketing.title"),
      description: t("cards.employeeMarketing.description"),
      icon: Video,
      href: `/${safeLocale}/admin/employee-marketing`,
      color: "bg-violet-50 text-violet-700",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/employee-marketing/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.payrollExport.title"),
      description: t("cards.payrollExport.description"),
      icon: Wallet,
      href: `/${safeLocale}/admin/nomina`,
      color: "bg-emerald-50 text-emerald-700",
      // No está en AdminNav.tsx -- API usa "payroll" (src/app/api/admin/payroll-export/route.ts).
      resource: "payroll",
    },
    {
      title: t("cards.economicParameters.title"),
      description: t("cards.economicParameters.description"),
      icon: DollarSign,
      href: `/${safeLocale}/admin/parametros-economicos`,
      color: "bg-amber-50 text-amber-700",
      // No está en AdminNav.tsx -- API usa "payroll" (src/app/api/admin/economic-params/route.ts).
      resource: "payroll",
    },
    {
      title: t("cards.legalMonitoring.title"),
      description: t("cards.legalMonitoring.description"),
      icon: Scale,
      href: `/${safeLocale}/admin/monitoreo-legal`,
      color: "bg-slate-50 text-slate-700",
      // No está en AdminNav.tsx -- API usa "compliance" (src/app/api/admin/legal-monitoring/route.ts).
      resource: "compliance",
    },
    {
      title: t("cards.pipeda.title"),
      description: t("cards.pipeda.description"),
      icon: ShieldAlert,
      href: `/${safeLocale}/admin/pipeda`,
      color: "bg-red-50 text-red-700",
      // No está en AdminNav.tsx -- API usa "compliance" (src/app/api/admin/pipeda/requests/route.ts).
      resource: "compliance",
    },
    {
      title: t("cards.giftProgram.title"),
      description: t("cards.giftProgram.description"),
      icon: Gift,
      href: `/${safeLocale}/admin/regalos`,
      color: "bg-pink-50 text-pink-700",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/retention-gifts/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.growthMetrics.title"),
      description: t("cards.growthMetrics.description"),
      icon: Target,
      href: `/${safeLocale}/admin/growth-metrics`,
      color: "bg-teal-50 text-teal-800",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/growth-metrics/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.entityNotes.title"),
      description: t("cards.entityNotes.description"),
      icon: StickyNote,
      href: `/${safeLocale}/admin/entity-notes`,
      color: "bg-yellow-50 text-yellow-700",
      // No está en AdminNav.tsx -- API usa "dispatch" (src/app/api/admin/entity-notes/route.ts).
      resource: "dispatch",
    },
    {
      title: t("cards.stressScenario.title"),
      description: t("cards.stressScenario.description"),
      icon: TrendingDown,
      href: `/${safeLocale}/admin/stress-scenario`,
      color: "bg-red-50 text-red-800",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/stress-scenario/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.legacyMigration.title"),
      description: t("cards.legacyMigration.description"),
      icon: Archive,
      href: `/${safeLocale}/admin/legacy-migration`,
      color: "bg-gray-100 text-gray-700",
      // No está en AdminNav.tsx -- API usa "finance" (src/app/api/admin/legacy-migration/route.ts).
      resource: "finance",
    },
    {
      title: t("cards.certifications.title"),
      description: t("cards.certifications.description"),
      icon: BadgeCheck,
      href: `/${safeLocale}/admin/certificaciones`,
      color: "bg-indigo-50 text-indigo-800",
      // No está en AdminNav.tsx -- API usa "compliance" (src/app/api/admin/certifications/route.ts).
      resource: "compliance",
    },
    {
      title: t("cards.craRemittances.title"),
      description: t("cards.craRemittances.description"),
      icon: Landmark,
      href: `/${safeLocale}/admin/cra-remittances`,
      color: "bg-emerald-50 text-emerald-800",
      resource: "compliance",
    },
    {
      title: t("cards.backupStatus.title"),
      description: t("cards.backupStatus.description"),
      icon: DatabaseBackup,
      href: `/${safeLocale}/admin/backups`,
      color: "bg-slate-50 text-slate-800",
      // No está en AdminNav.tsx -- API usa "compliance" (src/app/api/admin/backup-status/route.ts).
      resource: "compliance",
    },
    {
      title: t("cards.contractReviews.title"),
      description: t("cards.contractReviews.description"),
      icon: FileSignature,
      href: `/${safeLocale}/admin/contract-reviews`,
      color: "bg-cyan-50 text-cyan-800",
      resource: "compliance",
    },
    {
      title: t("cards.laborCompliance.title"),
      description: t("cards.laborCompliance.description"),
      icon: CalendarDays,
      href: `/${safeLocale}/admin/cumplimiento-laboral`,
      color: "bg-orange-50 text-orange-800",
      // No está en AdminNav.tsx -- agrega rest-periods/sick-leave/statutory-holiday-pay/
      // weekly-rest-violations, todas con "compliance" en sus APIs.
      resource: "compliance",
    },
  ];

  const visibleCards = cards.filter((card) => roleAllows(roles, card.resource));

  // Fix (auditoría externa 2026-07-31, item 10): ~45 tarjetas sin buscador
  // ni agrupación visual eran difíciles de escanear. En vez de inventar
  // categorías nuevas, se reusan los grupos que YA existen en
  // AdminNav.tsx (buildGroups) -- son la misma taxonomía que el propio
  // dueño definió para el menú de navegación. Las tarjetas cuyo href no
  // tiene un link equivalente en el nav (la mayoría de las ~30 "No está en
  // AdminNav.tsx" de arriba) caen en un grupo "Otros" al final.
  const [search, setSearch] = useState("");
  const navGroups = buildGroups(`/${safeLocale}/admin`, tNav);
  const hrefToGroupLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of navGroups) {
      for (const link of group.links) {
        map.set(link.href, group.label);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeLocale]);

  const query = search.trim().toLowerCase();
  const filteredCards = query
    ? visibleCards.filter(
        (card) =>
          card.title.toLowerCase().includes(query) || card.description.toLowerCase().includes(query)
      )
    : visibleCards;

  const otherGroupLabel = t("otherGroup");
  const groupedCards = new Map<string, typeof filteredCards>();
  for (const card of filteredCards) {
    const groupLabel = hrefToGroupLabel.get(card.href) || otherGroupLabel;
    const existing = groupedCards.get(groupLabel) || [];
    existing.push(card);
    groupedCards.set(groupLabel, existing);
  }
  // Orden estable: primero los grupos en el mismo orden que AdminNav.tsx,
  // "Otros" al final.
  const orderedGroupLabels = [
    ...navGroups.map((g) => g.label).filter((label) => groupedCards.has(label)),
    ...(groupedCards.has(otherGroupLabel) ? [otherGroupLabel] : []),
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>

      <AutopilotModeBanner locale={safeLocale} />

      {roleAllows(roles, "finance") && <DashboardMetricsPanel />}

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
        <div className="space-y-6">
          {orderedGroupLabels.map((groupLabel) => {
            const groupCards = groupedCards.get(groupLabel) || [];
            return (
              <details key={groupLabel} open className="group/section">
                <summary className="cursor-pointer select-none text-sm font-semibold text-brand-ink mb-3 flex items-center gap-2">
                  <ChevronRight className="w-4 h-4 text-gray-400 transition-transform group-open/section:rotate-90" aria-hidden="true" />
                  {groupLabel}
                  <span className="text-xs font-normal text-gray-400">({groupCards.length})</span>
                </summary>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {groupCards.map((card) => {
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
                          <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand-navy transition-colors" />
                        </div>
                        <h2 className="mt-3 font-semibold text-brand-ink">{card.title}</h2>
                        <p className="mt-1 text-sm text-gray-500">{card.description}</p>
                      </Link>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
