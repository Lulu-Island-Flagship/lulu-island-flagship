"use client";

// v8.3 E0 — Rehecho a partir de feedback directo del dueño (notas escritas a
// mano, 2026-07-11): "las opciones que estan arriba estan muy desordenadas y
// son muchas. mejor hacer un menu de opciones" + "el diseno tiene que estar
// optimo para verse en smartphones". La barra anterior en layout.tsx era una
// fila plana de 19 links -- se reemplaza por un menú agrupado por categoría
// (desktop: dropdowns; mobile: acordeón deslizable) y se agrega el único
// link que existía en el dashboard de tarjetas pero no en el nav
// (Quote Reviews, ver AdminDashboardClient.tsx).

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Menu, X } from "lucide-react";

type NavLink = { label: string; href: string };
type NavGroup = { label: string; links: NavLink[] };

function buildGroups(adminPath: string): NavGroup[] {
  return [
    {
      label: "Operations",
      links: [
        { label: "Services", href: `${adminPath}/servicios` },
        { label: "Employees", href: `${adminPath}/empleados` },
        { label: "Vehicles", href: `${adminPath}/vehicles` },
        { label: "Checklists", href: `${adminPath}/checklists` },
        { label: "Inventario", href: `${adminPath}/inventario` },
      ],
    },
    {
      label: "Quality & Risk",
      links: [
        { label: "QC", href: `${adminPath}/qc` },
        { label: "Audits", href: `${adminPath}/audits` },
        { label: "Near-Misses", href: `${adminPath}/near-misses` },
        { label: "Riesgo", href: `${adminPath}/riesgo` },
        { label: "SOS", href: `${adminPath}/sos` },
        { label: "Disaster Recovery", href: `${adminPath}/recuperacion-desastres` },
      ],
    },
    {
      label: "Sales & Customer",
      links: [
        { label: "Tickets", href: `${adminPath}/tickets` },
        { label: "Quote Reviews", href: `${adminPath}/quotes-review` },
        { label: "Upsells", href: `${adminPath}/upsells` },
        { label: "Marketing", href: `${adminPath}/marketing` },
        { label: "Competencia", href: `${adminPath}/competencia` },
      ],
    },
    {
      label: "Finance & Settings",
      links: [
        { label: "Pricing Rules", href: `${adminPath}/pricing-rules` },
        { label: "Pricing Settings", href: `${adminPath}/pricing-settings` },
        { label: "Contabilidad", href: `${adminPath}/contabilidad` },
        { label: "Team Ranking", href: `${adminPath}/team-ranking` },
        { label: "Ajustes HHE", href: `${adminPath}/ajustes-hhe` },
        { label: "Seguridad", href: `${adminPath}/seguridad` },
      ],
    },
  ];
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

export default function AdminNav({ adminPath }: { adminPath: string }) {
  const groups = buildGroups(adminPath);
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
