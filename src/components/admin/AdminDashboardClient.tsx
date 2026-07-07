"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Users,
  Tag,
  ListChecks,
  ChevronRight,
  Shield,
  Star,
  AlertTriangle,
} from "lucide-react";

export default function AdminDashboardClient() {
  const router = useRouter();

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
      title: "Field Audits",
      description: "Evaluate completed services and view audit history",
      icon: Star,
      href: `/${safeLocale}/admin/audits`,
      color: "bg-orange-50 text-orange-600",
    },
    {
      title: "QC Review",
      description: "Quality control wall — approve or reject services",
      icon: Shield,
      href: `/${safeLocale}/admin/qc`,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      title: "Tickets",
      description: "Disputes, discrepancies, and consultation queue",
      icon: AlertTriangle,
      href: `/${safeLocale}/admin/tickets`,
      color: "bg-red-50 text-red-600",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-ink">Admin Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.title}
              onClick={() => router.push(card.href)}
              className="bg-white rounded-xl border p-5 text-left hover:shadow-md transition-shadow group"
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand-navy transition-colors" />
              </div>
              <h2 className="mt-3 font-semibold text-brand-ink">{card.title}</h2>
              <p className="mt-1 text-sm text-gray-500">{card.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
