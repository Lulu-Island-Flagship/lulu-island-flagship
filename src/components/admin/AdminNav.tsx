"use client";

// v8.3 E0 — Rehecho a partir de feedback directo del dueño (notas escritas a
// mano, 2026-07-11): "las opciones que estan arriba estan muy desordenadas y
// son muchas. mejor hacer un menu de opciones" + "el diseno tiene que estar
// optimo para verse en smartphones". La barra anterior en layout.tsx era una
// fila plana de 19 links -- se reemplaza por un menú agrupado por categoría
// (desktop: dropdowns; mobile: acordeón deslizable) y se agrega el único
// link que existía en el dashboard de tarjetas pero no en el nav
// (Quote Reviews, ver AdminDashboardClient.tsx).
//
// v8.3 fix G-4 (auditoría staff/admin): este nav renderizaba TODOS los links
// sin importar el rol admin del usuario -- un qc_only (que solo debería ver
// "QC") veía el menú completo de un owner_admin, incluyendo Pricing Rules,
// Employees (nómina) y Seguridad (backup codes). Cada link ahora declara su
// AdminResource (misma matriz que ya protege las APIs, ver
// src/lib/admin-rbac.ts) y se filtra con roleAllows() contra los roles reales
// del usuario, que ahora llegan como prop desde admin/layout.tsx. Un grupo
// que se queda sin links visibles no se renderiza.
//
// v8.3 fix G-3: se agregan 5 páginas admin que existían y funcionaban pero
// no tenían ningún link en la UI (warranty-claims, phone-booking, wallet,
// comunicaciones, config-history) -- solo alcanzables escribiendo la URL a
// mano. El resource RBAC de cada una se tomó de su API real
// (requireAdminRole(...) en src/app/api/admin/**/route.ts), no inventado.

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, Menu, X } from "lucide-react";
import { roleAllows, type AdminRole, type AdminResource } from "@/lib/admin-rbac";
import { useFocusTrap } from "@/lib/useFocusTrap";

export type NavLink = { label: string; href: string; resource: AdminResource };
export type NavGroup = { label: string; links: NavLink[] };

/** Función de traducción mínima que necesita buildGroups(): admite tanto
 * next-intl useTranslations('admin.nav') (cliente) como getTranslations
 * (servidor) -- ambas exponen la misma firma (key) => string. */
type NavT = (key: string) => string;

// Exportado para que AdminBreadcrumbs.tsx reuse la misma estructura de
// grupos/labels en vez de mantener una segunda lista duplicada.
// v8.3 fix (auditoría i18n 2026-07-25): las labels eran texto fijo en
// inglés -- ahora se resuelven contra admin.nav.groups.* / admin.nav.links.*
// (ver messages/{en,fr,zh}.json) para que el nav se muestre en el idioma del
// usuario. `t` debe venir de useTranslations("admin.nav") o equivalente.
export function buildGroups(adminPath: string, t: NavT): NavGroup[] {
  return [
    {
      label: t("groups.operations"),
      links: [
        { label: t("links.services"), href: `${adminPath}/servicios`, resource: "services" },
        { label: t("links.employees"), href: `${adminPath}/empleados`, resource: "employees_admin" },
        { label: t("links.vehicles"), href: `${adminPath}/vehicles`, resource: "vehicles" },
        { label: t("links.checklists"), href: `${adminPath}/checklists`, resource: "checklists_sop" },
        { label: t("links.inventario"), href: `${adminPath}/inventario`, resource: "inventory" },
      ],
    },
    {
      label: t("groups.qualityRisk"),
      links: [
        { label: t("links.qc"), href: `${adminPath}/qc`, resource: "qc_wall" },
        { label: t("links.audits"), href: `${adminPath}/audits`, resource: "field_audits" },
        { label: t("links.nearMisses"), href: `${adminPath}/near-misses`, resource: "near_misses" },
        { label: t("links.riesgo"), href: `${adminPath}/riesgo`, resource: "risk_assessments" },
        // SOS usa el resource "tickets" -- ver comentario en
        // src/app/api/admin/safety-aborts/route.ts: un SOS es, en esencia,
        // el ticket de máxima prioridad del sistema, no un resource propio.
        { label: t("links.sos"), href: `${adminPath}/sos`, resource: "tickets" },
        // DR Drills consume /api/admin/dr-drill, que usa el
        // resource "feature_flags" (interruptores del sistema, solo owner_admin).
        // 2026-07-24: apuntaba a /admin/recuperacion-desastres, una página
        // duplicada con menos funcionalidad que /admin/dr-drill (la que enlaza
        // el dashboard). Se consolidó en una sola página real; ver comentario
        // en dr-drill/page.tsx. /admin/recuperacion-desastres ahora solo redirige.
        // Label alineado con el título de la tarjeta del dashboard ("DR Drills")
        // para que ambos puntos de entrada usen el mismo texto.
        { label: t("links.drDrills"), href: `${adminPath}/dr-drill`, resource: "feature_flags" },
        // v8.3 fix M-7 (auditoría implacable 2026-07-20b): página huérfana --
        // /admin/contingencia existía y funcionaba (manual de contingencia de
        // una página, E7 D.7.10) pero no tenía ningún link en ningún lado del
        // frontend, solo alcanzable escribiendo la URL a mano. La página es
        // estática (no llama a ninguna API propia), así que el resource se
        // infiere por naturaleza: es guía operativa de emergencia, mismo tipo
        // de acceso que Disaster Recovery/SOS (owner_admin + ops_coordinator).
        { label: t("links.contingencia"), href: `${adminPath}/contingencia`, resource: "tickets" },
      ],
    },
    {
      label: t("groups.salesCustomer"),
      links: [
        { label: t("links.tickets"), href: `${adminPath}/tickets`, resource: "tickets" },
        { label: t("links.quoteReviews"), href: `${adminPath}/quotes-review`, resource: "quotes_review" },
        { label: t("links.upsells"), href: `${adminPath}/upsells`, resource: "upsells_review" },
        { label: t("links.marketing"), href: `${adminPath}/marketing`, resource: "upsells_review" },
        // Competencia usa el resource "finance" en su API
        // (src/app/api/admin/competencia/route.ts).
        { label: t("links.competencia"), href: `${adminPath}/competencia`, resource: "finance" },
        // v8.3 fix G-3: reclamos de garantía reportados por el cliente --
        // API usa el resource "tickets" (src/app/api/admin/warranty-claims/route.ts).
        { label: t("links.warrantyClaims"), href: `${adminPath}/warranty-claims`, resource: "tickets" },
        // v8.3 fix G-3: reserva por teléfono, resource propio "phone_booking".
        { label: t("links.phoneBooking"), href: `${adminPath}/phone-booking`, resource: "phone_booking" },
      ],
    },
    {
      label: t("groups.financeSettings"),
      links: [
        { label: t("links.pricingRules"), href: `${adminPath}/pricing-rules`, resource: "pricing_rules" },
        // v8.3 fix M-7: página huérfana -- /admin/pricing-rules/sandbox
        // (simulador de reglas de precio) llama a las mismas APIs que
        // Pricing Rules (/api/admin/pricing-rules y /simulate, ambas con
        // requireAdminRole("pricing_rules")) pero no tenía link propio.
        { label: t("links.pricingRulesSandbox"), href: `${adminPath}/pricing-rules/sandbox`, resource: "pricing_rules" },
        { label: t("links.pricingSettings"), href: `${adminPath}/pricing-settings`, resource: "pricing_settings" },
        { label: t("links.contabilidad"), href: `${adminPath}/contabilidad`, resource: "finance" },
        { label: t("links.teamRanking"), href: `${adminPath}/team-ranking`, resource: "wellbeing" },
        { label: t("links.ajustesHhe"), href: `${adminPath}/ajustes-hhe`, resource: "hhe_settings" },
        { label: t("links.seguridad"), href: `${adminPath}/seguridad`, resource: "security_backup_codes" },
        // v8.3 fix G-3: wallet de créditos/reembolsos de cliente -- API usa
        // el resource "finance" (src/app/api/admin/wallet/route.ts).
        { label: t("links.wallet"), href: `${adminPath}/wallet`, resource: "finance" },
        // v8.3 fix G-3: plantillas de comunicación -- API usa el resource
        // "finance" (src/app/api/admin/communication-templates/route.ts).
        { label: t("links.comunicaciones"), href: `${adminPath}/comunicaciones`, resource: "finance" },
        // v8.3 fix G-3: historial de cambios de configuración -- API usa el
        // resource "finance" (src/app/api/admin/config-history/route.ts).
        { label: t("links.configHistory"), href: `${adminPath}/config-history`, resource: "finance" },
        // v8.3 fix B-2: alta/revocación de owner_admin/ops_coordinator/qc_only
        // -- resource dedicado "admin_roles_management", solo owner_admin.
        { label: t("links.roles"), href: `${adminPath}/roles`, resource: "admin_roles_management" },
        // v8.4 — Compliance y Remesas Fiscales: paneles de administración
        // para reglas legales (compliance) y remesas de nómina (payroll).
        { label: t("links.compliance"), href: `${adminPath}/compliance`, resource: "compliance" },
        { label: t("links.payrollRemittances"), href: `${adminPath}/payroll-remittances`, resource: "payroll" },
      ],
    },
  ];
}

/** Filtra grupos/links por los roles admin reales del usuario; quita grupos vacíos. */
function filterGroupsByRole(groups: NavGroup[], roles: AdminRole[]): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => roleAllows(roles, link.resource)),
    }))
    .filter((group) => group.links.length > 0);
}

/** Un link cuenta como activo si la ruta actual es exactamente su href, o
 * un descendiente de él (ej. /admin/pricing-rules/sandbox activa también
 * "Pricing Rules" -- pero se usa comparación por segmento completo, no
 * startsWith crudo, para que /admin/servicios no active /admin/servicios-x). */
function isLinkActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DesktopDropdown({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const groupActive = group.links.some((link) => isLinkActive(pathname, link.href));

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-current={groupActive ? "true" : undefined}
        className={`flex items-center gap-1 text-sm transition-colors py-2 ${
          groupActive ? "text-white font-semibold underline underline-offset-4" : "hover:text-white"
        }`}
      >
        {group.label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white text-brand-ink rounded-lg shadow-elevation-2 border py-1 min-w-[180px] z-50">
          {group.links.map((link) => {
            const active = isLinkActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`block px-4 py-2 text-sm whitespace-nowrap ${
                  active ? "bg-brand-gold/10 text-brand-navy font-semibold" : "hover:bg-gray-50"
                }`}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminNav({ adminPath, roles }: { adminPath: string; roles: AdminRole[] }) {
  const t = useTranslations("admin.nav");
  const groups = filterGroupsByRole(buildGroups(adminPath, t), roles);
  const pathname = usePathname() || "";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileGroupOpen, setMobileGroupOpen] = useState<string | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Item 9 (auditoría 2026-07-25): el menú móvil no atrapaba el foco -- un
  // usuario de teclado podía tabular fuera del menú abierto hacia el
  // contenido de la página detrás. useFocusTrap mantiene Tab/Shift+Tab
  // dentro del panel mientras está abierto.
  useFocusTrap(mobileMenuRef, mobileOpen);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (mobileGroupOpen !== null) {
        setMobileGroupOpen(null);
      } else if (mobileOpen) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, mobileGroupOpen]);

  return (
    <>
      {/* Desktop: dropdowns agrupados, ya no 19 links en fila */}
      <div className="hidden md:flex items-center gap-5 text-sm">
        {groups.map((group) => (
          <DesktopDropdown key={group.label} group={group} pathname={pathname} />
        ))}
      </div>

      {/* Mobile: botón hamburguesa + acordeón deslizable */}
      <button
        className="md:hidden p-2"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
      </button>

      {mobileOpen && (
        <div
          ref={mobileMenuRef}
          className="md:hidden absolute top-full left-0 right-0 bg-brand-navy text-white shadow-elevation-2 z-50 max-h-[80vh] overflow-y-auto"
        >
          {groups.map((group) => {
            const groupActive = group.links.some((link) => isLinkActive(pathname, link.href));
            return (
              <div key={group.label} className="border-t border-white/10">
                <button
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium ${
                    groupActive ? "text-white underline underline-offset-4" : ""
                  }`}
                  onClick={() =>
                    setMobileGroupOpen((v) => (v === group.label ? null : group.label))
                  }
                  aria-expanded={mobileGroupOpen === group.label}
                  aria-current={groupActive ? "true" : undefined}
                >
                  {group.label}
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${
                      mobileGroupOpen === group.label ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>
                {mobileGroupOpen === group.label && (
                  <div className="pb-2">
                    {group.links.map((link) => {
                      const active = isLinkActive(pathname, link.href);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          aria-current={active ? "page" : undefined}
                          className={`block px-8 py-2 text-sm ${
                            active ? "text-white font-semibold underline underline-offset-4" : "text-white/80 hover:text-white"
                          }`}
                          onClick={() => setMobileOpen(false)}
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
