"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  Loader2,
  Calendar,
  MapPin,
  Clock,
  Wallet,
  Camera,
  Truck,
  Repeat,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { formatServiceDateDisplay, formatServiceTimeDisplay } from "@/lib/date-utils";

// ── Tipos ─────────────────────────────────────────────────────────────────

interface DashboardData {
  profile: { fullName: string | null; avatarUrl: string | null };
  nextService: {
    id: string;
    serviceDate: string;
    serviceTime: string;
    status: string;
    address: string | null;
    zone: string | null;
    serviceType: string | null;
    serviceSubtype: string | null;
    total: number | null;
  } | null;
  lastService: {
    id: string;
    serviceDate: string;
    address: string | null;
    serviceType: string | null;
    serviceSubtype: string | null;
  } | null;
  wallet: { balanceCents: number; currency: string };
  defaultPaymentMethod: {
    lastFour: string;
    expiryMonth: number;
    expiryYear: number;
  } | null;
  alerts: string[];
  servicesCount: number;
}

// ── Componente ────────────────────────────────────────────────────────────

export default function DashboardClient() {
  const t = useTranslations("cuenta.dashboard");
  const tCommon = useTranslations("cuenta.common");
  const tStatus = useTranslations("cuenta.orderStatus");
  const locale = useLocale();
  const router = useRouter();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      try {
        const res = await fetch("/api/client/dashboard", { credentials: "include" });
        if (!res.ok) {
          if (res.status === 401) {
            setLoading(false);
            return;
          }
          throw new Error(`Dashboard fetch failed: ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError(tCommon("networkErrorRetry"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  // ── Loading ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-4">
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <p className="text-sm text-brand-ink/70 text-center">{error || tCommon("loadFailedRetry")}</p>
        <button
          onClick={() => { setLoading(true); setError(""); setRetryKey((k) => k + 1); }}
          className="px-4 py-2 text-sm bg-brand-navy text-white rounded-lg hover:bg-brand-navy/90 transition-colors"
        >
          {tCommon("retry")}
        </button>
      </div>
    );
  }

  const { profile, nextService, lastService, wallet, defaultPaymentMethod, alerts, servicesCount } = data;
  const firstName = profile.fullName?.split(" ")[0] ?? null;
  const hasWalletBalance = wallet.balanceCents > 0;
  const cardExpiryLabel = defaultPaymentMethod?.expiryMonth && defaultPaymentMethod.expiryYear
    ? `${String(defaultPaymentMethod.expiryMonth).padStart(2, "0")}/${String(defaultPaymentMethod.expiryYear).slice(-2)}`
    : null;

  // Alerta si la tarjeta por defecto vence en ≤90 días
  const cardExpiringSoon = defaultPaymentMethod?.expiryMonth && defaultPaymentMethod.expiryYear
    ? (() => {
        const now = new Date();
        const expiry = new Date(defaultPaymentMethod.expiryYear, defaultPaymentMethod.expiryMonth - 1);
        const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays <= 90 && diffDays >= 0;
      })()
    : false;

  // ── Helpers de etiquetas ──────────────────────────────────────────────
  const serviceTypeLabels: Record<string, string> = {
    regular: t("serviceTypes.regular"),
    deep: t("serviceTypes.deep"),
    move_in_out: t("serviceTypes.moveInOut"),
    post_construction: t("serviceTypes.postConstruction"),
  };

  function serviceLabel(st: string | null, ss: string | null): string {
    if (ss) return ss;
    if (st && serviceTypeLabels[st]) return serviceTypeLabels[st];
    return t("serviceTypes.default");
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* ── Saludo ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-ink">
            {firstName ? t("greetingWithName", { name: firstName }) : t("greeting")}
          </h1>
          <p className="text-sm text-brand-ink/60 mt-0.5">
            {servicesCount === 0
              ? t("subtitleFirstTime")
              : t("subtitle", { count: servicesCount })}
          </p>
        </div>
        {profile.avatarUrl && (
          <img
            src={profile.avatarUrl}
            alt={profile.fullName ?? ""}
            className="w-10 h-10 rounded-full border-2 border-brand-ice"
            onError={() => setAvatarError(true)}
            style={avatarError ? { display: "none" } : undefined}
          />
        )}
        {(avatarError || !profile.avatarUrl) && null}
      </div>

      {/* ── Alertas ─────────────────────────────────────────────────── */}
      {alerts.includes("phone_not_verified") && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p>{t("alerts.phoneNotVerified")}</p>
          </div>
        </div>
      )}

      {cardExpiringSoon && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p>{t("alerts.cardExpiring", { lastFour: defaultPaymentMethod?.lastFour ?? "", date: cardExpiryLabel ?? "" })}</p>
          </div>
        </div>
      )}

      {/* ── Próxima reserva ─────────────────────────────────────────── */}
      {nextService ? (
        <div className="bg-brand-navy text-white rounded-2xl p-5 shadow-lg">
          <div className="flex items-center gap-2 text-brand-ice/80 text-xs font-medium uppercase tracking-wider mb-3">
            <Calendar className="w-3.5 h-3.5" />
            {t("nextServiceLabel")}
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-lg font-bold">
                {formatServiceDateDisplay(nextService.serviceDate, locale)}
                {" · "}
                {formatServiceTimeDisplay(nextService.serviceTime, locale)}
              </p>
              <p className="text-brand-ice/90 text-sm mt-0.5">
                {serviceLabel(nextService.serviceType, nextService.serviceSubtype)}
              </p>
            </div>

            {nextService.address && (
              <div className="flex items-start gap-1.5 text-brand-ice/80 text-sm">
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{nextService.address}{nextService.zone ? ` · ${nextService.zone}` : ""}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-brand-ice/80 text-sm">
              <div className={`w-2 h-2 rounded-full ${nextService.status === "confirmed" ? "bg-green-400" : "bg-amber-400"}`} />
              <span>{tStatus(nextService.status as "pending" | "confirmed" | "completed" | "cancelled" | "no_show")}</span>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Link
              href={`/${locale}/cuenta/servicios/${nextService.id}/tracking`}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium transition-colors"
            >
              <Truck className="w-3.5 h-3.5" />
              {t("trackTeam")}
            </Link>
            <Link
              href={`/${locale}/cuenta/servicios`}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium transition-colors"
            >
              {t("viewAllServices")}
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        /* Sin próximas reservas */
        <div className="bg-brand-ice rounded-2xl p-6 text-center border-2 border-dashed border-brand-navy/10">
          <Sparkles className="w-8 h-8 text-brand-navy/40 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-brand-ink mb-1">
            {servicesCount === 0 ? t("noServicesYetTitle") : t("noUpcomingTitle")}
          </h2>
          <p className="text-sm text-brand-ink/60 mb-4">
            {servicesCount === 0 ? t("noServicesYetDesc") : t("noUpcomingDesc")}
          </p>
          <button
            onClick={() => router.push(`/${locale}/cotizador`)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-navy text-white rounded-xl font-medium hover:bg-brand-navy/90 transition-colors shadow-md"
          >
            <Sparkles className="w-4 h-4" />
            {t("bookFirstCleaning")}
          </button>
        </div>
      )}

      {/* ── Grid: Wallet + Último servicio ──────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Wallet Card */}
        <div className="bg-white rounded-2xl p-4 border border-brand-ice shadow-sm">
          <div className="flex items-center gap-2 text-brand-ink/60 text-xs font-medium uppercase tracking-wider mb-2">
            <Wallet className="w-3.5 h-3.5" />
            {t("luluCredit")}
          </div>
          <p className="text-2xl font-bold text-brand-navy">
            {formatCurrency(wallet.balanceCents / 100, locale)}
          </p>
          {defaultPaymentMethod && (
            <p className="text-xs text-brand-ink/50 mt-1">
              💳 •••• {defaultPaymentMethod.lastFour}
              {cardExpiryLabel ? ` · ${cardExpiryLabel}` : ""}
            </p>
          )}
          <Link
            href={`/${locale}/cuenta/billetera`}
            className="inline-flex items-center gap-1 mt-2 text-sm text-brand-navy/70 hover:text-brand-navy transition-colors"
          >
            {hasWalletBalance ? t("viewWallet") : t("addPaymentMethod")}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Último servicio completado */}
        {lastService ? (
          <div className="bg-white rounded-2xl p-4 border border-brand-ice shadow-sm">
            <div className="flex items-center gap-2 text-brand-ink/60 text-xs font-medium uppercase tracking-wider mb-2">
              <Camera className="w-3.5 h-3.5" />
              {t("lastServiceLabel")}
            </div>
            <p className="text-sm font-semibold text-brand-ink">
              {formatServiceDateDisplay(lastService.serviceDate, locale)}
            </p>
            <p className="text-sm text-brand-ink/60">
              {serviceLabel(lastService.serviceType, lastService.serviceSubtype)}
              {lastService.address ? ` · ${lastService.address}` : ""}
            </p>
            <div className="flex gap-3 mt-2">
              <Link
                href={`/${locale}/cuenta/servicios/${lastService.id}/galeria`}
                className="inline-flex items-center gap-1 text-sm text-brand-navy/70 hover:text-brand-navy transition-colors"
              >
                <Camera className="w-3.5 h-3.5" />
                {t("viewPhotos")}
              </Link>
              <Link
                href={`/${locale}/cuenta/servicios/${lastService.id}/galeria`}
                className="inline-flex items-center gap-1 text-sm text-brand-navy/70 hover:text-brand-navy transition-colors"
              >
                <Repeat className="w-3.5 h-3.5" />
                {t("bookAgain")}
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-4 border border-brand-ice shadow-sm">
            <div className="flex items-center gap-2 text-brand-ink/60 text-xs font-medium uppercase tracking-wider mb-2">
              <Clock className="w-3.5 h-3.5" />
              {t("quickActions")}
            </div>
            <Link
              href={`/${locale}/cuenta/propiedades`}
              className="inline-flex items-center gap-1 text-sm text-brand-navy/70 hover:text-brand-navy transition-colors"
            >
              {t("manageProperties")}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* ── Accesos rápidos ─────────────────────────────────────────── */}
      {servicesCount > 0 && (
        <div className="bg-white rounded-2xl border border-brand-ice shadow-sm divide-y divide-brand-ice/50">
          <Link
            href={`/${locale}/cuenta/servicios`}
            className="flex items-center justify-between px-4 py-3 hover:bg-brand-ice/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-brand-navy/60" />
              <span className="text-sm font-medium text-brand-ink">{t("allServices")}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-brand-ink/30" />
          </Link>
          <Link
            href={`/${locale}/cuenta/propiedades`}
            className="flex items-center justify-between px-4 py-3 hover:bg-brand-ice/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-brand-navy/60" />
              <span className="text-sm font-medium text-brand-ink">{t("myProperties")}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-brand-ink/30" />
          </Link>
          <Link
            href={`/${locale}/cuenta/billetera`}
            className="flex items-center justify-between px-4 py-3 hover:bg-brand-ice/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-brand-navy/60" />
              <span className="text-sm font-medium text-brand-ink">{t("walletAndPayments")}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-brand-ink/30" />
          </Link>
        </div>
      )}
    </div>
  );
}
