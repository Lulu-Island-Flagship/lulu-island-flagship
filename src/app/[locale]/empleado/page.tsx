"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import {
  Shield,
  MapPin,
  Clock,
  Calendar,
  Home,
  ChevronRight,
  Play,
  CheckCircle2,
  Loader2,
  LogOut,
  Navigation,
  AlertCircle,
  Star,
  Users,
  Video,
  AlertOctagon,
  Sunrise,
  Shirt,
} from "lucide-react";
import type { EmployeeService } from "@/types";
import { downloadAndCacheDayBundle } from "@/lib/offline-day-cache";
import { getAllQueuedEvents } from "@/lib/offline-queue";
import { triggerSyncCycle } from "@/lib/offline-sync-client";
import { ErrorBanner } from "@/components/empleado/ErrorBanner";
import { SkeletonServiceList } from "@/components/ui/Skeleton";

type JornadaStatus = "not_started" | "started";
type OfflineDownloadStatus = "idle" | "downloading" | "ready" | "failed";

export default function EmpleadoPage() {
  const router = useRouter();
  const params = useParams();
  const t = useTranslations("employee");

  // Auditoría UX/seguridad 2026-07-25 (#1): antes esta página repetía su
  // propia verificación de sesión (llamando de nuevo a
  // /api/staff/resolve-login vía resolveEmployeeAccess()) además de la que
  // ya hace el layout server-side (src/app/[locale]/empleado/layout.tsx,
  // resolveStaffLogin()). Esa segunda verificación era puro trabajo
  // duplicado -- si el layout no redirige, ya sabemos que el usuario está
  // autenticado y autorizado como empleado -- y encima mostraba un spinner
  // en inglés fijo ("Redirecting to the Team Portal…") en cada carga antes
  // de poder ver el dashboard. Se elimina la repetición: isAuthenticated ya
  // no gatea el render inicial, solo se usa para reaccionar a un cierre de
  // sesión que ocurra mientras la pestaña sigue abierta.
  const [employeeName, setEmployeeName] = useState("");
  const [employeeRole, setEmployeeRole] = useState("");

  const [services, setServices] = useState<EmployeeService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  // #8: antes un error de red/servidor al cargar /api/empleado/servicios
  // simplemente dejaba services=[] y loadingServices=false -- indistinguible
  // de "no tienes servicios hoy" para el empleado. Ahora se separa el estado
  // de error real del de "genuinely empty".
  const [servicesError, setServicesError] = useState("");
  const [jornadaStatus, setJornadaStatus] = useState<JornadaStatus>("not_started");
  const [isStartingJornada, setIsStartingJornada] = useState(false);
  const [jornadaError, setJornadaError] = useState("");
  // v8.3 E4 (D.10.1-2): estado de la precarga offline (ruta+SOP+accesos del día).
  const [offlineDownloadStatus, setOfflineDownloadStatus] = useState<OfflineDownloadStatus>("idle");
  // #7: evita doble-click en "Sign out" mientras se vacía la cola offline.
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Detect locale from route params (needed both by the auth effect below and
  // by navigation links further down) -- movido arriba del useEffect para que
  // esté disponible en el primer render sin depender del orden textual.
  // 2026-07-24: antes leía window.location.pathname, lo que causaba un
  // hydration mismatch (SSR asumía "en", cliente calculaba el locale real) --
  // ver auditoría externa. useParams() da el mismo valor en servidor y
  // cliente porque viene del router de Next, no de window.
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
  const portalUrl = `/${safeLocale}/portal?next=/${safeLocale}/empleado`;
  const intlLocale = safeLocale === "zh" ? "zh-CN" : safeLocale === "fr" ? "fr-CA" : "en-CA";

  // v8.3 fix G-1 + auditoría 2026-07-25 (#1): el layout server-side ya
  // garantiza sesión válida y area="empleado" antes de renderizar esta
  // página (redirect() ocurre antes de llegar aquí) -- así que en el mount
  // vamos directo a cargar los datos, sin repetir la llamada a
  // /api/staff/resolve-login. loadEmployeeData() igual maneja un 401/403
  // (p.ej. sesión que expiró justo entre el layout y este render) mandando
  // al Portal, así que sigue habiendo una red de seguridad.
  useEffect(() => {
    loadEmployeeData();

    // Reacciona a un signOut que ocurra mientras la pestaña sigue abierta
    // (ej. otra pestaña cerró sesión, o el token expiró y el propio SDK de
    // Supabase lo detecta) -- no repite la verificación de autorización,
    // solo saca al usuario si ya no hay sesión.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setServices([]);
        setLoadingServices(false);
        router.replace(portalUrl);
      }
    });

    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadEmployeeData() {
    setLoadingServices(true);
    setServicesError("");
    try {
      const res = await fetch("/api/empleado/servicios", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // v8.3 fix G-1: sin modal propio -- al Portal de equipo.
          router.replace(portalUrl);
          return;
        }
        // #8: error real del servidor (5xx, etc.) -- se distingue de "no
        // tienes servicios hoy" en vez de dejar la lista vacía en silencio.
        setServicesError(t("dashboard.loadError"));
        setLoadingServices(false);
        return;
      }
      const data = await res.json();
      setEmployeeName(data.employee?.name || "");
      setEmployeeRole(data.employee?.role || "");
      setServices(data.services || []);

      // Check if jornada was started today
      await checkJornadaStatus();
    } catch (e) {
      console.error("Load employee data error:", e);
      // #8: fallo de red (offline, timeout, etc.) -- mismo tratamiento que
      // un error de servidor, con opción de reintentar.
      setServicesError(t("dashboard.loadError"));
    } finally {
      setLoadingServices(false);
    }
  }

  async function checkJornadaStatus() {
    try {
      // Timestamp en Vancouver con offset explícito para comparar correctamente con TIMESTAMPTZ
      const vancouverDate = new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", timeZoneName: "short" });
      const today = vancouverDate.split(",")[0];
      const isPDT = vancouverDate.includes("PDT");
      const offset = isPDT ? "-07:00" : "-08:00";
      const { data: logs } = await supabase
        .from("service_logs")
        .select("event_type")
        .eq("event_type", "jornada_start")
        .gte("timestamp", `${today}T00:00:00${offset}`)
        .order("timestamp", { ascending: false })
        .limit(1);

      if (logs && logs.length > 0) {
        setJornadaStatus("started");
      }
    } catch (e) {
      console.error("Check jornada error:", e);
    }
  }

  // #7: antes handleLogout llamaba directo a supabase.auth.signOut() sin
  // tocar la cola offline (src/lib/offline-queue.ts) -- si un empleado
  // cerraba sesión con eventos de servicio (fotos, T_in/T_out, notas)
  // todavía sin sincronizar, esos quedaban atrapados en IndexedDB del
  // dispositivo hasta que alguien volviera a iniciar sesión ahí. Ahora se
  // intenta un ciclo de sync ANTES de cerrar sesión (mientras el token
  // todavía es válido para escribir), y si sigue quedando algo pendiente
  // (ej. sin red en este momento) se avisa explícitamente en vez de
  // cerrar sesión en silencio.
  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const pending = await getAllQueuedEvents().catch(() => []);
      if (pending.length > 0) {
        await triggerSyncCycle().catch(() => {});
        const stillPending = await getAllQueuedEvents().catch(() => []);
        if (stillPending.length > 0) {
          const proceed = window.confirm(
            t("dashboard.unsyncedWarning", { count: stillPending.length })
          );
          if (!proceed) {
            setIsLoggingOut(false);
            return;
          }
        }
      }

      await supabase.auth.signOut();
      setServices([]);
      setEmployeeName("");
      setJornadaStatus("not_started");
      // v8.3 fix G-1: sin modal propio -- de vuelta al Portal de equipo para
      // un login limpio.
      router.push(`/${safeLocale}/portal`);
    } finally {
      setIsLoggingOut(false);
    }
  };

  async function sendVehicleLocation() {
    if (!navigator.geolocation) return;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true });
      });
      await fetch("/api/empleado/vehicle-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: "driver_app",
        }),
      });
    } catch {
      // Silencioso: el tracking de vehículo es opcional si no hay vehículo asignado
    }
  }

  const handleStartJornada = async () => {
    setIsStartingJornada(true);
    setJornadaError("");
    try {
      let locationLat: number | undefined;
      let locationLng: number | undefined;

      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
          });
          locationLat = pos.coords.latitude;
          locationLng = pos.coords.longitude;
        } catch {
          // Geolocation failed, continue without it
        }
      }

      const res = await fetch("/api/empleado/jornada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "start", locationLat, locationLng }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Jornada start error:", err.error);
        setJornadaError(err.error || t("dashboard.startShiftError"));
        return;
      }

      // Registrar ubicación del vehículo al inicio de jornada
      if (locationLat !== undefined && locationLng !== undefined) {
        await sendVehicleLocation();
      }

      setJornadaStatus("started");

      // v8.3 E4 (D.10.1-2, criterio E4 #1): descargar ruta+SOP+accesos del día
      // a IndexedDB AHORA, mientras hay red en el punto de encuentro, para
      // poder abrir cualquier servicio sin conexión después. Si falla, nunca
      // bloquea el inicio de jornada — solo se avisa al líder.
      setOfflineDownloadStatus("downloading");
      const dlResult = await downloadAndCacheDayBundle();
      setOfflineDownloadStatus(dlResult.ok ? "ready" : "failed");
    } catch (e) {
      console.error("Start jornada error:", e);
      setJornadaError(t("dashboard.startShiftConnectionError"));
    } finally {
      setIsStartingJornada(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending": return <AlertCircle className="w-4 h-4 text-gray-400" />;
      case "en_route": return <Navigation className="w-4 h-4 text-brand-gold" />;
      case "arrived": return <MapPin className="w-4 h-4 text-state-success" />;
      case "in_progress": return <Play className="w-4 h-4 text-brand-navy" />;
      case "completed": return <CheckCircle2 className="w-4 h-4 text-state-success" />;
      default: return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pending": return t("status.pending");
      case "en_route": return t("status.en_route");
      case "arrived": return t("status.arrived");
      case "in_progress": return t("status.in_progress");
      case "completed": return t("status.completed");
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-gray-100 text-gray-600";
      case "en_route": return "bg-brand-gold/10 text-brand-gold";
      case "arrived": return "bg-state-success/10 text-state-success";
      case "in_progress": return "bg-brand-navy/10 text-brand-navy";
      case "completed": return "bg-state-success/10 text-state-success";
      default: return "bg-gray-100 text-gray-600";
    }
  };

  // Nota #1: el layout server-side (src/app/[locale]/empleado/layout.tsx)
  // ya garantiza sesión + autorización de empleado antes de que este
  // componente monte -- no hay un estado "no autenticado" que renderizar
  // aquí. El único loading real es el de loadEmployeeData() (servicios del
  // día), manejado más abajo con SkeletonServiceList / servicesError.

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-gold" />
            <div>
              <span className="font-semibold text-sm">Lulu Island Flagship</span>
              <p className="text-xs text-gray-400 capitalize">{employeeRole}</p>
            </div>
          </div>
          <button
            aria-label={t("dashboard.logout")}
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="text-gray-300 hover:text-white transition-colors disabled:opacity-50"
          >
            {isLoggingOut ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <LogOut className="w-5 h-5" />
            )}
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Welcome */}
        <div>
          <h1 className="text-xl font-bold text-brand-ink">
            {t("goodMorning")}, {employeeName.split(" ")[0] || t("team")}
          </h1>
          <p className="text-sm text-gray-500">
            {new Date().toLocaleDateString(intlLocale, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Jornada Button */}
        {jornadaStatus === "not_started" ? (
          <div className="space-y-2">
            <button
              aria-label={t("startShift")}
              onClick={handleStartJornada}
              disabled={isStartingJornada}
              className="w-full bg-brand-navy text-white py-4 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isStartingJornada ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  {t("startShift")}
                </>
              )}
            </button>
            <ErrorBanner message={jornadaError} onRetry={handleStartJornada} retrying={isStartingJornada} />
          </div>
        ) : (
          <div className="bg-state-success/10 text-state-success py-3 px-4 rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-medium">{t("shiftStarted")}</span>
            <span className="text-sm ml-auto">{t("readyToWork")}</span>
          </div>
        )}

        {/* v8.3 E4 (D.10.1-2): estado de la precarga offline del día. Nunca
            bloquea nada — solo informa al líder si puede confiar en trabajar
            sin señal desde ya. */}
        {offlineDownloadStatus === "downloading" && (
          <div className="flex items-center gap-2 text-xs text-gray-500 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t("dashboard.downloadingRoute")}
          </div>
        )}
        {offlineDownloadStatus === "ready" && (
          <div className="flex items-center gap-2 text-xs text-state-success px-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t("dashboard.routeReady")}
          </div>
        )}
        {offlineDownloadStatus === "failed" && (
          <div className="flex items-center gap-2 text-xs text-state-warning px-1">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("dashboard.routeFailed")}
          </div>
        )}

        {/* Services List -- v8.3 fix (auditoría 2026-07-24): antes esta
            sección iba DEBAJO de la cuadrícula de 8 quick links, obligando a
            scrollear para ver el trabajo del día (lo único que realmente
            importa al abrir el dashboard en jornada). Se sube al primer
            lugar, inmediatamente debajo del botón de jornada, sin cambiar
            ninguna lógica -- solo el orden en el JSX. Los quick links bajan
            a una sección secundaria más compacta más abajo. */}
        <div>
          <h2 className="text-lg font-semibold text-brand-ink mb-4">
            {t("todaysServices")}
          </h2>

          {loadingServices ? (
            <SkeletonServiceList count={3} />
          ) : servicesError ? (
            // #8: error real (fetch/servidor) distinguido de "genuinely empty"
            // -- con botón de reintentar en vez de una lista vacía silenciosa.
            <ErrorBanner message={servicesError} onRetry={loadEmployeeData} retrying={loadingServices} />
          ) : services.length === 0 ? (
            <div className="bg-white rounded-xl shadow-elevation-1 p-8 text-center">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">{t("noServices")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {services.map((svc) => (
                <button
                  key={svc.assignmentId}
                  onClick={() => router.push(`/${safeLocale}/empleado/servicio/${svc.orderId}`)}
                  className="w-full bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Home className="w-4 h-4 text-brand-gold" />
                      <span className="font-medium text-brand-ink capitalize text-sm">
                        {svc.serviceSubtype?.replace(/_/g, " ") || t("dashboard.defaultServiceLabel")}
                      </span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusColor(svc.status)}`}>
                      {getStatusIcon(svc.status)}
                      <span className="ml-1">{getStatusLabel(svc.status)}</span>
                    </span>
                  </div>

                  <div className="space-y-1 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      <span>{t("dashboard.atTime", { date: svc.serviceDate, time: svc.serviceTime })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      <span className="truncate">{svc.address}, {svc.zone}</span>
                    </div>
                    {svc.clientName && (
                      <div className="text-xs text-gray-400">
                        {t("dashboard.clientLabel", { name: svc.clientName })}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-brand-navy text-sm font-medium mt-3">
                    <span>{t("openService")}</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick Links -- movidos a segunda prioridad visual (antes ocupaban
            toda la mitad superior de la pantalla con el mismo peso que
            "Today's Services"). Misma cantidad de enlaces, mismo destino y
            mismo texto -- solo una cuadrícula más compacta (4 columnas,
            ícono + etiqueta corta, sin descripción) para que quepan en
            mucho menos alto y no compitan por atención con el trabajo del
            día. */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {t("dashboard.more")}
          </h2>
          <div className="grid grid-cols-4 gap-2">
            <a
              href={`/${safeLocale}/empleado/score`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Star className="w-4 h-4 text-brand-gold" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.myScore")}</span>
            </a>
            <a
              href={`/${safeLocale}/empleado/votacion`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Users className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.peerVoting")}</span>
            </a>
            {/* v8.3 E8.1: checklist de disposición matutina (sueño/ánimo/atajo) — antes construido pero inalcanzable */}
            <a
              href={`/${safeLocale}/empleado/checkin`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Sunrise className="w-4 h-4 text-brand-gold-dark" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.checkin")}</span>
            </a>
            {/* v8.3 E7.3: ciclo de paños/inventario — antes construido pero inalcanzable */}
            <a
              href={`/${safeLocale}/empleado/panos`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Shirt className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.cloths")}</span>
            </a>
            {/* v8.3 E8.13: ritual de inicio/fin de jornada (equipo, clima, ranking, ganancias, insignias) */}
            <a
              href={`/${safeLocale}/empleado/ritual`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Star className="w-4 h-4 text-brand-gold-dark" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.shiftRitual")}</span>
            </a>
            {/* v8.3 E10.8: consentimiento opcional para reels/insignias públicas */}
            <a
              href={`/${safeLocale}/empleado/marketing`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Video className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.marketing")}</span>
            </a>
            {/* BC ESA Parte 5.1: reportar ausencia por enfermedad */}
            <a
              href={`/${safeLocale}/empleado/enfermedad`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <AlertCircle className="w-4 h-4 text-state-warning" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.sickDay")}</span>
            </a>
            {/* BC ESA s.32: descansos documentados vía tránsito */}
            <a
              href={`/${safeLocale}/empleado/descansos`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Clock className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.myBreaks")}</span>
            </a>
            {/* E7 D.10.7: SOS, near-miss y reporte de incidente laboral */}
            <a
              href={`/${safeLocale}/empleado/seguridad`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow border border-state-danger/20"
            >
              <AlertOctagon className="w-4 h-4 text-state-danger" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.safety")}</span>
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
