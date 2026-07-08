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
} from "lucide-react";

export default function AdminDashboardClient() {
  // Detect locale from pathname for navigation
  const locale = (typeof window !== "undefined" 
    ? window.location.pathname.split("/")[1] 
    : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const cards = [
    {
      title: "Today's Services",
      description: "View all scheduled services for today with checklist progress",
      icon: ClipboardList,
      href: `/${safeLocale}/admin/servicios`,
      color: "bg-blue-50 text-blue-600",
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
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-ink">Admin Dashboard</h1>

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
