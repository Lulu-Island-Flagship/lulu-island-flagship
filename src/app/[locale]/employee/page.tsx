"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
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
  TowelRack,
} from "lucide-react";
import type { EmployeeService } from "@/types";
import { downloadAndCacheDayBundle } from "@/lib/offline-day-cache";
import { getAllQueuedEvents } from "@/lib/offline-queue";
import { triggerSyncCycle } from "@/lib/offline-sync-client";
import { getVancouverTodayString, getVancouverOffset } from "@/lib/date-utils";
import { ErrorBanner } from "@/components/empleado/ErrorBanner";
import { SkeletonServiceList } from "@/components/ui/Skeleton";
// Fix (auditoría externa, hallazgo confirmado): el logout con eventos
// offline sin sincronizar usaba window.confirm() nativo -- no accesible, no
// estilizable, y bloqueado por popup blockers en algunos navegadores/
// entornos embebidos (mismo motivo que ya llevó a reemplazar 11 usos en el
// admin, ver cabecera de ConfirmActionModal.tsx). Se reutiliza ese mismo
// componente genérico en vez de crear uno nuevo -- no tiene ninguna lógica
// específica de admin, solo confirmación accesible con focus trap.
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";
import MarketplaceSection from "@/components/empleado/MarketplaceSection";

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
  // Fix (auditoría externa, hallazgo confirmado): checkJornadaStatus()
  // consultaba service_logs sin filtrar por employee_id -- un supervisor
  // (cuyas políticas RLS le permiten leer los logs de todos los empleados)
  // veía su propia jornada como "iniciada" si CUALQUIER empleado de la
  // empresa había marcado inicio de jornada ese día. El id (viene de
  // /api/employee/services, antes se descartaba) se pasa directo por
  // parámetro a checkJornadaStatus() en vez de guardarse en estado -- no
  // hace falta un useState acá porque nada más en el componente lo lee, y
  // evita el problema de leer un valor de estado desactualizado justo
  // después de setState (ver el parámetro currentEmployeeId más abajo).
  // Fix (auditoría externa, hallazgo confirmado): ver sendVehicleLocation()
  // más abajo -- antes un fallo real de tracking de vehículo era
  // indistinguible de "no tengo vehículo asignado" (mismo catch vacío).
  const [vehicleTrackingFailed, setVehicleTrackingFailed] = useState(false);
  // Fix (auditoría externa, hallazgo confirmado): distingue "está
  // reintentando en este momento" de "se agotaron los intentos" para el
  // mensaje visible -- ver sendVehicleLocation/scheduleVehicleLocationRetry.
  const [vehicleTrackingRetrying, setVehicleTrackingRetrying] = useState(false);

  const [services, setServices] = useState<EmployeeService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  // #8: antes un error de red/servidor al cargar /api/employee/services
  // simplemente dejaba services=[] y loadingServices=false -- indistinguible
  // de "no tienes servicios hoy" para el empleado. Ahora se separa el estado
  // de error real del de "genuinely empty".
  const [servicesError, setServicesError] = useState("");
  const [jornadaStatus, setJornadaStatus] = useState<JornadaStatus>("not_started");
  const [isStartingJornada, setIsStartingJornada] = useState(false);
  const [jornadaError, setJornadaError] = useState("");
  // Fix (auditoría 2026-07-31, #2): el backend (/api/employee/shift,
  // action="end") ya soportaba cerrar la jornada -- solo faltaba el botón
  // en esta UI, dejando a los empleados sin forma de marcar salida desde
  // el dashboard. Se agrega con confirmación explícita (ConfirmActionModal,
  // mismo patrón ya usado para logout con eventos sin sincronizar) para
  // evitar un cierre accidental de jornada.
  const [isEndingJornada, setIsEndingJornada] = useState(false);
  const [endJornadaError, setEndJornadaError] = useState("");
  const [showEndJornadaModal, setShowEndJornadaModal] = useState(false);
  // v8.3 E4 (D.10.1-2): estado de la precarga offline (ruta+SOP+accesos del día).
  const [offlineDownloadStatus, setOfflineDownloadStatus] = useState<OfflineDownloadStatus>("idle");
  // #7: evita doble-click en "Sign out" mientras se vacía la cola offline.
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Fix (auditoría externa, hallazgo confirmado): reemplaza window.confirm()
  // -- ver import de ConfirmActionModal arriba.
  const [showUnsyncedLogoutModal, setShowUnsyncedLogoutModal] = useState(false);
  const [unsyncedCount, setUnsyncedCount] = useState(0);

  // Detect locale from route params (needed both by the auth effect below and
  // by navigation links further down) -- movido arriba del useEffect para que
  // esté disponible en el primer render sin depender del orden textual.
  // 2026-07-24: antes leía window.location.pathname, lo que causaba un
  // hydration mismatch (SSR asumía "en", cliente calculaba el locale real) --
  // ver auditoría externa. useParams() da el mismo valor en servidor y
  // cliente porque viene del router de Next, no de window.
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
  const portalUrl = `/${safeLocale}/portal?next=/${safeLocale}/employee`;
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
    // Fix (auditoría de autenticación 2026-07-25/26, item 3): el callback de
    // onAuthStateChange recibe `session` del SDK, que viene del JWT local sin
    // validar contra el servidor. Antes de tomar una decisión de seguridad
    // (sacar o no al usuario), se confirma con una llamada explícita a
    // getUser() en vez de confiar ciegamente en session?.user.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setServices([]);
        setLoadingServices(false);
        router.replace(portalUrl);
        return;
      }
      supabase.auth.getUser().then(({ data }) => {
        if (!data.user) {
          setServices([]);
          setLoadingServices(false);
          router.replace(portalUrl);
        }
      });
    });

    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadEmployeeData() {
    setLoadingServices(true);
    setServicesError("");
    try {
      const res = await fetch("/api/employee/services", { credentials: "include" });
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
      const currentEmployeeId: string | null = data.employee?.id || null;
      setEmployeeName(data.employee?.name || "");
      setEmployeeRole(data.employee?.role || "");
      setServices(data.services || []);

      // Check if jornada was started today. currentEmployeeId se pasa
      // directo por parámetro en vez de por estado -- ver el comentario
      // junto a la declaración de checkJornadaStatus más abajo.
      await checkJornadaStatus(currentEmployeeId);
    } catch (e) {
      console.error("Load employee data error:", e);
      // #8: fallo de red (offline, timeout, etc.) -- mismo tratamiento que
      // un error de servidor, con opción de reintentar.
      setServicesError(t("dashboard.loadError"));
    } finally {
      setLoadingServices(false);
    }
  }

  async function checkJornadaStatus(currentEmployeeId: string | null) {
    if (!currentEmployeeId) {
      // Sin id de empleado todavía (no debería pasar si loadEmployeeData
      // tuvo éxito, pero se evita una query sin filtro por las dudas -- ver
      // el bug que esto reemplaza en el comentario de arriba).
      return;
    }
    try {
      // Timestamp en Vancouver con offset explícito para comparar correctamente con TIMESTAMPTZ.
      // v8.3 ROUND 4 fix (#2): antes parseaba "PDT"/"PST" de toLocaleString(), que puede
      // devolver "GMT-7" en vez de la abreviatura según navegador/runtime. Usamos el offset
      // numérico real vía Intl (getVancouverOffset), robusto en cualquier entorno.
      const today = getVancouverTodayString();
      const offset = getVancouverOffset(today);
      const { data: logs } = await supabase
        .from("service_logs")
        .select("event_type")
        .eq("event_type", "jornada_start")
        .eq("employee_id", currentEmployeeId)
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
  // Fix (auditoría de autenticación 2026-07-25/26, item 4): antes cerraba
  // sesión directo desde el navegador con supabase.auth.signOut(), a
  // diferencia de /admin (POST a /auth/signout, ver
  // src/app/[locale]/admin/layout.tsx). Se unifica al mismo endpoint
  // server-side vía fetch (no un <form> submit normal, porque antes hay
  // trabajo async -- el ciclo de sync offline -- que debe completarse
  // primero). credentials:"include" para que la Route Handler reciba las
  // cookies de sesión a limpiar. Extraído a su propia función para poder
  // invocarse tanto desde el flujo directo (sin eventos pendientes) como
  // desde la confirmación del modal (ver handleConfirmLogoutWithUnsynced).
  const performSignOut = async () => {
    await fetch(`/auth/signout?locale=${safeLocale}`, {
      method: "POST",
      credentials: "include",
    });
    setServices([]);
    setEmployeeName("");
    setJornadaStatus("not_started");
    // v8.3 fix G-1: sin modal propio -- de vuelta al Portal de equipo para
    // un login limpio.
    router.push(`/${safeLocale}/portal`);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const pending = await getAllQueuedEvents().catch(() => []);
      if (pending.length > 0) {
        await triggerSyncCycle().catch(() => {});
        const stillPending = await getAllQueuedEvents().catch(() => []);
        if (stillPending.length > 0) {
          // Fix (auditoría externa, hallazgo confirmado): antes esto era
          // window.confirm() nativo -- se reemplaza por ConfirmActionModal
          // (renderizado más abajo). El propio modal maneja su estado de
          // carga/error al confirmar, así que acá solo se abre y se corta el
          // flujo -- isLoggingOut se libera en el `finally` de abajo para que
          // el ícono del header no quede girando mientras el modal está
          // abierto (el modal tiene su propio spinner al confirmar).
          setUnsyncedCount(stillPending.length);
          setShowUnsyncedLogoutModal(true);
          return;
        }
      }

      await performSignOut();
    } finally {
      setIsLoggingOut(false);
    }
  };

  // onConfirm del modal: el empleado decidió cerrar sesión de todos modos
  // pese a tener eventos sin sincronizar. Si performSignOut() lanza, el
  // modal muestra el error y permanece abierto (mismo contrato que el resto
  // de usos de ConfirmActionModal) -- nunca se pierde el aviso en silencio.
  const handleConfirmLogoutWithUnsynced = async () => {
    await performSignOut();
    setShowUnsyncedLogoutModal(false);
  };

  // Fix (auditoría externa, hallazgo confirmado): un fallo real de tracking
  // de vehículo (no "sin vehículo asignado") solo activaba el estado
  // interno vehicleTrackingFailed una vez, sin ningún reintento automático
  // -- si la ubicación no salió por un problema transitorio de red justo al
  // iniciar jornada, quedaba así hasta el próximo inicio de jornada del día
  // siguiente. Se agrega un backoff simple (cada 30s, hasta 3 intentos en
  // total) -- mismo orden de magnitud que el backoff de la cola offline
  // (ver nextRetryDelayMs en offline-queue.ts), sin reutilizar esa cola
  // porque vehicle-tracking no es un evento de servicio encolable (no tiene
  // orderId ni pasa por submitServiceEventOrQueue). La notificación en la UI
  // (vehicleTrackingFailed, renderizado más abajo) permanece visible
  // mientras se reintenta y también si se agotan los 3 intentos -- nunca
  // vuelve a ser un estado puramente interno/silencioso.
  const VEHICLE_TRACKING_MAX_ATTEMPTS = 3;
  const VEHICLE_TRACKING_RETRY_DELAY_MS = 30000;

  async function sendVehicleLocation(attempt = 1) {
    if (!navigator.geolocation) return;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true });
      });
      const res = await fetch("/api/employee/vehicle-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: "driver_app",
        }),
      });
      // Fix (auditoría externa, hallazgo confirmado): antes este catch{} vacío
      // se tragaba TODO fallo por igual -- "sin vehículo asignado" (esperado,
      // la mayoría de empleados no maneja) y un fallo real de red/servidor
      // quedaban indistinguibles. El operario creía que su ubicación se
      // transmitía cuando en realidad el envío fallaba en silencio. La API
      // (/api/employee/vehicle-tracking) devuelve 400 "No vehicle assigned"
      // para el caso esperado -- ese sí se ignora (nunca se reintenta: no es
      // un fallo transitorio, es un estado permanente del empleado). Cualquier
      // otro código (401/500/etc.) es un fallo real: se reintenta con backoff.
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        const noVehicleAssigned = res.status === 400 && /no vehicle assigned/i.test(body?.error || "");
        if (noVehicleAssigned) {
          setVehicleTrackingFailed(false);
          setVehicleTrackingRetrying(false);
          return;
        }
        scheduleVehicleLocationRetry(attempt);
        return;
      }
      setVehicleTrackingFailed(false);
      setVehicleTrackingRetrying(false);
    } catch {
      // Fallo real: permiso GPS denegado, timeout, sin red, etc. -- antes
      // era indistinguible de "no tengo vehículo asignado".
      scheduleVehicleLocationRetry(attempt);
    }
  }

  function scheduleVehicleLocationRetry(attempt: number) {
    setVehicleTrackingFailed(true);
    if (attempt >= VEHICLE_TRACKING_MAX_ATTEMPTS) {
      // Intentos agotados: la notificación queda visible (no silenciosa),
      // pero ya no se reintenta más automáticamente por este inicio de
      // jornada -- evita seguir golpeando el servidor/GPS indefinidamente.
      setVehicleTrackingRetrying(false);
      return;
    }
    setVehicleTrackingRetrying(true);
    setTimeout(() => {
      void sendVehicleLocation(attempt + 1);
    }, VEHICLE_TRACKING_RETRY_DELAY_MS);
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

      const res = await fetch("/api/employee/shift", {
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

  const handleEndJornada = async () => {
    setIsEndingJornada(true);
    setEndJornadaError("");
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

      const res = await fetch("/api/employee/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "end", locationLat, locationLng }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Jornada end error:", err.error);
        setEndJornadaError(err.error || t("dashboard.endShiftError"));
        return;
      }

      setJornadaStatus("not_started");
      setShowEndJornadaModal(false);
    } catch (e) {
      console.error("End jornada error:", e);
      setEndJornadaError(t("dashboard.endShiftConnectionError"));
    } finally {
      setIsEndingJornada(false);
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
      case "en_route": return "bg-brand-gold/10 text-brand-gold-dark";
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
            <Shield className="w-5 h-5 text-brand-gold-dark" />
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
          <div className="space-y-2">
            <div className="bg-state-success/10 text-state-success py-3 px-4 rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">{t("shiftStarted")}</span>
              <span className="text-sm ml-auto">{t("readyToWork")}</span>
            </div>
            <button
              type="button"
              aria-label={t("dashboard.endShift")}
              onClick={() => setShowEndJornadaModal(true)}
              disabled={isEndingJornada}
              className="w-full border border-state-danger text-state-danger py-3 rounded-xl font-semibold hover:bg-state-danger/5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isEndingJornada ? <Loader2 className="w-5 h-5 animate-spin" /> : t("dashboard.endShift")}
            </button>
            <ErrorBanner message={endJornadaError} onRetry={() => setShowEndJornadaModal(true)} retrying={isEndingJornada} />
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
        {/* Fix (auditoría externa, hallazgo confirmado): antes un fallo real
            de tracking de vehículo (GPS denegado, sin red, error del
            servidor) era indistinguible de "no tengo vehículo asignado" --
            el operario creía que su ubicación se transmitía cuando en
            realidad fallaba en silencio. No bloquea nada, solo informa --
            ahora distingue "reintentando" de "se agotaron los intentos"
            (ver sendVehicleLocation/scheduleVehicleLocationRetry). */}
        {vehicleTrackingFailed && (
          <div className="flex items-center gap-2 text-xs text-state-warning px-1">
            {vehicleTrackingRetrying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5" />
            )}
            {vehicleTrackingRetrying
              ? t("dashboard.vehicleTrackingRetrying")
              : t("dashboard.vehicleTrackingFailed")}
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
            <div className="bg-white rounded-xl shadow-elevation-1 p-6 text-center">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm mb-4">{t("noServices")}</p>
              {jornadaStatus === "started" && (
                <div className="border-t pt-4 mt-2 text-left">
                  <p className="text-xs font-semibold text-brand-ink/60 uppercase tracking-wider mb-3">
                    {t("basicTasksTitle")}
                  </p>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-brand-wave-blue mt-0.5 shrink-0" />
                      {t("basicTask1")}
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-brand-wave-blue mt-0.5 shrink-0" />
                      {t("basicTask2")}
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-brand-wave-blue mt-0.5 shrink-0" />
                      {t("basicTask3")}
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-brand-wave-blue mt-0.5 shrink-0" />
                      {t("basicTask4")}
                    </li>
                  </ul>
                  <p className="text-xs text-gray-400 mt-3 italic">
                    {t("basicTasksNote")}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {services.map((svc) => (
                <button
                  key={svc.assignmentId}
                  onClick={() => router.push(`/${safeLocale}/employee/service/${svc.orderId}`)}
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

        {/* v8.3 F.8: Marketplace de Turnos entre empleados */}
        <MarketplaceSection locale={safeLocale} />

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
            {/* Fix (auditoría 2026-07-31, #10): estos enlaces usaban <a href>
                nativos, forzando una recarga completa de página en cada tap
                (perdiendo el estado de React en memoria, incluida la sesión
                del cliente de Supabase en el navegador) en vez de una
                navegación SPA. Se reemplazan por next/link. */}
            <Link
              href={`/${safeLocale}/employee/score`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Star className="w-4 h-4 text-brand-gold-dark" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.myScore")}</span>
            </Link>
            <Link
              href={`/${safeLocale}/employee/voting`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Users className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.peerVoting")}</span>
            </Link>
            {/* v8.3 E8.1: checklist de disposición matutina (sueño/ánimo/atajo) — antes construido pero inalcanzable */}
            <Link
              href={`/${safeLocale}/employee/checkin`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Sunrise className="w-4 h-4 text-brand-gold-dark" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.checkin")}</span>
            </Link>
            {/* v8.3 E7.3: ciclo de paños/inventario — antes construido pero inalcanzable */}
            {/* Fix (2026-08-02, reporte del usuario): el ícono Shirt (camiseta)
                se veía como ropa -- esto es sobre paños/trapos de limpieza, no
                prendas de vestir. TowelRack (toallero) es un ícono limpio y sin
                connotación de "trapo sucio" que representa mejor tela de limpieza. */}
            <Link
              href={`/${safeLocale}/employee/cloths`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <TowelRack className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.cloths")}</span>
            </Link>
            {/* v8.3 E8.13: ritual de inicio/fin de jornada (equipo, clima, ranking, ganancias, insignias) */}
            <Link
              href={`/${safeLocale}/employee/ritual`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Star className="w-4 h-4 text-brand-gold-dark" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.shiftRitual")}</span>
            </Link>
            {/* v8.3 E10.8: consentimiento opcional para reels/insignias públicas */}
            <Link
              href={`/${safeLocale}/employee/marketing`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Video className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.marketing")}</span>
            </Link>
            {/* BC ESA Parte 5.1: reportar ausencia por enfermedad */}
            <Link
              href={`/${safeLocale}/employee/sickness`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <AlertCircle className="w-4 h-4 text-state-warning" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.sickDay")}</span>
            </Link>
            {/* BC ESA s.32: descansos documentados vía tránsito */}
            <Link
              href={`/${safeLocale}/employee/breaks`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow"
            >
              <Clock className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.myBreaks")}</span>
            </Link>
            {/* E7 D.10.7: SOS, near-miss y reporte de incidente laboral */}
            <Link
              href={`/${safeLocale}/employee/safety`}
              className="bg-white rounded-lg shadow-elevation-1 p-2.5 flex flex-col items-center text-center gap-1 hover:shadow-elevation-2 transition-shadow border border-state-danger/20"
            >
              <AlertOctagon className="w-4 h-4 text-state-danger" />
              <span className="font-medium text-[11px] leading-tight text-brand-ink">{t("dashboard.safety")}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Fix (auditoría externa, hallazgo confirmado): reemplaza el
          window.confirm() nativo que antes bloqueaba handleLogout() cuando
          quedaban eventos offline sin sincronizar -- ver
          handleConfirmLogoutWithUnsynced arriba. */}
      {showUnsyncedLogoutModal && (
        <ConfirmActionModal
          title={t("dashboard.logout")}
          message={t("dashboard.unsyncedWarning", { count: unsyncedCount })}
          danger
          onConfirm={handleConfirmLogoutWithUnsynced}
          onCancel={() => setShowUnsyncedLogoutModal(false)}
        />
      )}

      {/* Fix (auditoría 2026-07-31, #2): confirmación explícita antes de
          cerrar la jornada -- evita un tap accidental sobre "Terminar
          jornada" mientras el empleado todavía tiene servicios en curso. */}
      {showEndJornadaModal && (
        <ConfirmActionModal
          title={t("dashboard.endShiftConfirmTitle")}
          message={t("dashboard.endShiftConfirmMessage")}
          danger
          onConfirm={handleEndJornada}
          onCancel={() => setShowEndJornadaModal(false)}
        />
      )}
    </main>
  );
}
