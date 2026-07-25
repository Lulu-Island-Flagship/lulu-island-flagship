"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import OrderCommunicationTimeline from "@/components/admin/OrderCommunicationTimeline";

/**
 * v8.3 E6.3 — timeline de comunicación por orden, standalone (además de ser
 * un componente embebible en tickets/disputas vía OrderCommunicationTimeline).
 * Acceso directo por ID de orden mientras esa integración no exista.
 */
export default function OrderCommunicationTimelinePage() {
  const params = useParams();
  const orderId = params?.orderId as string;
  const t = useTranslations("admin.comunicacionesDetail");

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("orderLabel", { orderId })}</p>
      </div>
      <OrderCommunicationTimeline orderId={orderId} />
    </div>
  );
}
