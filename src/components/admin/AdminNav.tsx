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
import { ChevronDown, Menu, X } from "lucide-react";
import { roleAllows, type AdminRole, type AdminResource } from "@/lib/admin-rbac";

type NavLink = { label: string; href: string; resource: AdminResource };
type NavGroup = { label: string; links: NavLink[] };

function buildGroups(adminPath: string): NavGroup[] {
  return [
    {
      label: "Operations",
      links: [
        { label: "Services", href: `${adminPath}/servicios`, resource: "services" },
        { label: "Employees", href: `${adminPath}/empleados`, resource: "employees_admin" },
        { label: "Vehicles", href: `${adminPath}/vehicles`, resource: "vehicles" },
        { label: "Checklists", href: `${adminPath}/checklists`, resource: "checklists_sop" },
        { label: "Inventario", href: `${adminPath}/inventario`, resource: "inventory" },
      ],
    },
    {
      label: "Quality & Risk",
      links: [
        { label: "QC", href: `${adminPath}/qc`, resource: "qc_wall" },
        { label: "Audits", href: `${adminPath}/audits`, resource: "field_audits" },
        { label: "Near-Misses", href: `${adminPath}/near-misses`, resource: "near_misses" },
        { label: "Riesgo", href: `${adminPath}/riesgo`, resource: "risk_assessments" },
        // SOS usa el resource "tickets" -- ver comentario en
        // src/app/api/admin/safety-aborts/route.ts: un SOS es, en esencia,
        // el ticket de máxima prioridad del sistema, no un resource propio.
        { label: "SOS", href: `${adminPath}/sos`, resource: "tickets" },
        // Disaster Recovery consume /api/admin/dr-drill, que usa el
        // resource "feature_flags" (interruptores del sistema, solo owner_admin).
        { label: "Disaster Recovery", href: `${adminPath}/recuperacion-desastres`, resource: "feature_flags" },
      ],
    },
    {
      label: "Sales & Customer",
      links: [
        { label: "Tickets", href: `${adminPath}/tickets`, resource: "tickets" },
        { label: "Quote Reviews", href: `${adminPath}/quotes-review`, resource: "quotes_review" },
        { label: "Upsells", href: `${adminPath}/upsells`, resource: "upsells_review" },
        { label: "Marketing", href: `${adminPath}/marketing`, resource: "upsells_review" },
        // Competencia usa el resource "finance" en su API
        // (src/app/api/admin/competencia/route.ts).
        { label: "Competencia", href: `${adminPath}/competencia`, resource: "finance" },
        // v8.3 fix G-3: reclamos de garantía reportados por el cliente --
        // API usa el resource "tickets" (src/app/api/admin/warranty-claims/route.ts).
        { label: "Warranty Claims", href: `${adminPath}/warranty-claims`, resource: "tickets" },
        // v8.3 fix G-3: reserva por teléfono, resource propio "phone_booking".
        { label: "Phone Booking", href: `${adminPath}/phone-booking`, resource: "phone_booking" },
      ],
    },
    {
      label: "Finance & Settings",
      links: [
        { label: "Pricing Rules", href: `${adminPath}/pricing-rules`, resource: "pricing_rules" },
        { label: "Pricing Settings", href: `${adminPath}/pricing-settings`, resource: "pricing_settings" },
        { label: "Contabilidad", href: `${adminPath}/contabilidad`, resource: "finance" },
        { label: "Team Ranking", href: `${adminPath}/team-ranking`, resource: "wellbeing" },
        { label: "Ajustes HHE", href: `${adminPath}/ajustes-hhe`, resource: "hhe_settings" },
        { label: "Seguridad", href: `${adminPath}/seguridad`, resource: "security_backup_codes" },
        // v8.3 fix G-3: wallet de créditos/reembolsos de cliente -- API usa
        // el resource "finance" (src/app/api/admin/wallet/route.ts).
        { label: "Wallet", href: `${adminPath}/wallet`, resource: "finance" },
        // v8.3 fix G-3: plantillas de comunicación -- API usa el resource
        // "finance" (src/app/api/admin/communication-templates/route.ts).
        { label: "Comunicaciones", href: `${adminPath}/comunicaciones`, resource: "finance" },
        // v8.3 fix G-3: historial de cambios de configuración -- API usa el
        // resource "finance" (src/app/api/admin/config-history/route.ts).
        { label: "Config History", href: `${adminPath}/config-history`, resource: "finance" },
        // v8.3 fix B-2: alta/revocación de owner_admin/ops_coordinator/qc_only
        // -- resource dedicado "admin_roles_management", solo owner_admin.
        { label: "Roles", href: `${adminPath}/roles`, resource: "admin_roles_management" },
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

function DesktopDropdown({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm hover:text-brand-gold transition-colors py-2"
      >
        {group.label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white text-brand-ink rounded-lg shadow-elevation-2 border py-1 min-w-[180px] z-50">
          {group.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="block px-4 py-2 text-sm hover:bg-gray-50 whitespace-nowrap"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminNav({ adminPath, roles }: { adminPath: string; roles: AdminRole[] }) {
  const groups = filterGroupsByRole(buildGroups(adminPath), roles);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileGroupOpen, setMobileGroupOpen] = useState<string | null>(null);

  return (
    <>
      {/* Desktop: dropdowns agrupados, ya no 19 links en fila */}
      <div className="hidden md:flex items-center gap-5 text-sm">
        {groups.map((group) => (
          <DesktopDropdown key={group.label} group={group} />
        ))}
      </div>

      {/* Mobile: botón hamburguesa + acordeón deslizable */}
      <button
        className="md:hidden p-2"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {mobileOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-brand-navy text-white shadow-elevation-2 z-50 max-h-[80vh] overflow-y-auto">
          {groups.map((group) => (
            <div key={group.label} className="border-t border-white/10">
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
                onClick={() =>
                  setMobileGroupOpen((v) => (v === group.label ? null : group.label))
                }
              >
                {group.label}
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    mobileGroupOpen === group.label ? "rotate-180" : ""
                  }`}
                />
              </button>
              {mobileGroupOpen === group.label && (
                <div className="pb-2">
                  {group.links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      className="block px-8 py-2 text-sm text-white/80 hover:text-white"
                      onClick={() => setMobileOpen(false)}
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
