"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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

type JornadaStatus = "not_started" | "started";
type OfflineDownloadStatus = "idle" | "downloading" | "ready" | "failed";

// v8.3 fix G-1: /empleado ya no tiene su propio login (EmployeeAuthModal,
// eliminado) -- el único punto de entrada de staff es /portal
// (StaffLoginScreen.tsx). Cualquier visita sin sesión válida, o con una
// cuenta que no resuelve a area="empleado", redirige ahí en vez de mostrar
// un modal propio.
type EmployeeAccessResult =
  | { status: "authorized" }
  // v8.3 fix G-2: esta cuenta SÍ está autorizada (admin/qc), solo no es de
  // empleado -- no hay que cerrar sesión, solo mandarla a /portal para que
  // resuelva su destino real.
  | { status: "wrong_area" }
  // El servidor (/api/staff/resolve-login) ya cerró la sesión para este
  // caso (not_registered / pending_activation) antes de responder 403 --
  // ver comentario en resolveEmployeeAccess() más abajo.
  | { status: "rejected"; message: string };

export default function EmpleadoPage() {
  const router = useRouter();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeRole, setEmployeeRole] = useState("");

  const [services, setServices] = useState<EmployeeService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [jornadaStatus, setJornadaStatus] = useState<JornadaStatus>("not_started");
  const [isStartingJornada, setIsStartingJornada] = useState(false);
  // v8.3 E4 (D.10.1-2): estado de la precarga offline (ruta+SOP+accesos del día).
  const [offlineDownloadStatus, setOfflineDownloadStatus] = useState<OfflineDownloadStatus>("idle");

  // Detect locale from pathname (needed both by the auth effect below and by
  // navigation links further down) -- movido arriba del useEffect para que
  // esté disponible en el primer render sin depender del orden textual.
  const locale = (typeof window !== "undefined"
    ? window.location.pathname.split("/")[1]
    : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
  const portalUrl = `/${safeLocale}/portal?next=/${safeLocale}/empleado`;

  // Check auth on mount — verify employee authorization
  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // v8.3: la verificación real (incluida la vinculación automática de
        // employees.user_id en el primer login de un empleado invitado) vive
        // en /api/staff/resolve-login (src/lib/staff-login.ts) -- único punto
        // de autorización del Portal de equipo, compartido con /portal.
        const result = await resolveEmployeeAccess();
        if (result.status === "authorized") {
          setIsAuthenticated(true);
          loadEmployeeData();
        } else if (result.status === "wrong_area") {
          router.replace(portalUrl);
        } else {
          setAuthError(result.message);
          setLoadingServices(false);
          router.replace(portalUrl);
        }
      } else {
        // v8.3 fix G-1: ya no existe un login propio en /empleado -- redirige
        // al Portal de equipo unificado en vez de mostrar EmployeeAuthModal.
        setLoadingServices(false);
        router.replace(portalUrl);
      }
    }
    checkAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const result = await resolveEmployeeAccess();
        if (result.status === "authorized") {
          setIsAuthenticated(true);
          setAuthError("");
          loadEmployeeData();
        } else if (result.status === "wrong_area") {
          setIsAuthenticated(false);
          setServices([]);
          setLoadingServices(false);
          router.replace(portalUrl);
        } else {
          setIsAuthenticated(false);
          setServices([]);
          setLoadingServices(false);
          router.replace(portalUrl);
        }
      } else {
        setIsAuthenticated(false);
        setServices([]);
        setLoadingServices(false);
      }
    });

    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v8.3: delega en /api/staff/resolve-login (misma lógica que /portal) --
  // reconoce empleado (area="empleado") y rechaza cualquier otra área o
  // cuenta no registrada aquí, ya que esta pantalla es solo para empleados.
  //
  // v8.3 fix G-2: antes esta función devolvía un simple {authorized, message}
  // y el caller SIEMPRE llamaba supabase.auth.signOut() cuando authorized
  // era false -- incluso cuando la única razón era "esta cuenta es de
  // admin/qc, no de empleado" (data.path !== "/empleado"), lo que cerraba la
  // sesión de un admin/QC legítimo que solo visitó /empleado por error. Ahora
  // se distingue: "wrong_area" (cuenta válida, área equivocada -- NUNCA
  // signOut, solo redirigir a /portal) vs "rejected" (not_registered /
  // pending_activation -- /api/staff/resolve-login YA ejecuta signOut()
  // server-side en este caso antes de responder con status 403, ver
  // src/app/api/staff/resolve-login/route.ts, así que no hace falta
  // duplicarlo aquí).
  async function resolveEmployeeAccess(): Promise<EmployeeAccessResult> {
    try {
      const res = await fetch("/api/staff/resolve-login", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        return { status: "rejected", message: data.error || "Not authorized — contact your administrator." };
      }
      if (data.path !== "/empleado") {
        return { status: "wrong_area" };
      }
      return { status: "authorized" };
    } catch {
      return { status: "rejected", message: "Connection error verifying your account. Please try again." };
    }
  }

  async function loadEmployeeData() {
    setLoadingServices(true);
    try {
      const res = await fetch("/api/empleado/servicios", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // v8.3 fix G-1: sin modal propio -- al Portal de equipo.
          setIsAuthenticated(false);
          router.replace(portalUrl);
        }
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setServices([]);
    setEmployeeName("");
    setJornadaStatus("not_started");
    setAuthError("");
    // v8.3 fix G-1: sin modal propio -- de vuelta al Portal de equipo para
    // un login limpio.
    router.push(`/${safeLocale}/portal`);
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
        const err = await res.json();
        console.error("Jornada start error:", err.error);
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
      case "pending": return "Pending";
      case "en_route": return "En Route";
      case "arrived": return "Arrived";
      case "in_progress": return "In Progress";
      case "completed": return "Completed";
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

  if (!isAuthenticated) {
    // v8.3 fix G-1: sin sesión de empleado válida, siempre estamos en
    // camino a /portal (ver router.replace(portalUrl) más arriba) -- este
    // estado solo se ve un instante mientras el redirect ocurre.
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-brand-gold mx-auto" />
          <p className="text-sm text-gray-500">Redirecting to the Team Portal…</p>
          {authError && (
            <div className="bg-white rounded-lg shadow-elevation-2 p-4 max-w-sm w-full mx-auto mt-4">
              <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm text-center">
                {authError}
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

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
            aria-label="Cerrar sesión"
            onClick={handleLogout}
            className="text-gray-300 hover:text-white transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Welcome */}
        <div>
          <h1 className="text-xl font-bold text-brand-ink">
            Good morning, {employeeName.split(" ")[0] || "Team"}
          </h1>
          <p className="text-sm text-gray-500">
            {new Date().toLocaleDateString("en-CA", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Jornada Button */}
        {jornadaStatus === "not_started" ? (
          <button
            aria-label="Iniciar turno"
            onClick={handleStartJornada}
            disabled={isStartingJornada}
            className="w-full bg-brand-navy text-white py-4 rounded-xl font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isStartingJornada ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Play className="w-5 h-5" />
                Start Shift
              </>
            )}
          </button>
        ) : (
          <div className="bg-state-success/10 text-state-success py-3 px-4 rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-medium">Shift Started</span>
            <span className="text-sm ml-auto">Ready to work</span>
          </div>
        )}

        {/* v8.3 E4 (D.10.1-2): estado de la precarga offline del día. Nunca
            bloquea nada — solo informa al líder si puede confiar en trabajar
            sin señal desde ya. */}
        {offlineDownloadStatus === "downloading" && (
          <div className="flex items-center gap-2 text-xs text-gray-500 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Downloading today&apos;s route for offline use…
          </div>
        )}
        {offlineDownloadStatus === "ready" && (
          <div className="flex items-center gap-2 text-xs text-state-success px-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Today&apos;s route saved for offline use.
          </div>
        )}
        {offlineDownloadStatus === "failed" && (
          <div className="flex items-center gap-2 text-xs text-state-warning px-1">
            <AlertCircle className="w-3.5 h-3.5" />
            Couldn&apos;t save today&apos;s route for offline use — stay connected until reconnected.
          </div>
        )}

        {/* Quick Links */}
        <div className="grid grid-cols-2 gap-3">
          <a
            href={`/${safeLocale}/empleado/score`}
            className="bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1">
              <Star className="w-4 h-4 text-brand-gold" />
              <span className="font-medium text-sm text-brand-ink">My Score</span>
            </div>
            <p className="text-xs text-gray-400">View trust level & history</p>
          </a>
          <a
            href={`/${safeLocale}/empleado/votacion`}
            className="bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-sm text-brand-ink">Peer Voting</span>
            </div>
            <p className="text-xs text-gray-400">Rate your teammates</p>
          </a>
          {/* v8.3 E8.1: checklist de disposición matutina (sueño/ánimo/atajo) — antes construido pero inalcanzable */}
          <a
            href={`/${safeLocale}/empleado/checkin`}
            className="bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1">
              <Sunrise className="w-4 h-4 text-brand-gold-dark" />
              <span className="font-medium text-sm text-brand-ink">Morning Check-in</span>
            </div>
            <p className="text-xs text-gray-400">Sleep, mood &amp; route shortcut</p>
          </a>
          {/* v8.3 E7.3: ciclo de paños/inventario — antes construido pero inalcanzable */}
          <a
            href={`/${safeLocale}/empleado/panos`}
            className="bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1">
              <Shirt className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-sm text-brand-ink">Cloths &amp; Inventory</span>
            </div>
            <p className="text-xs text-gray-400">Cycle count &amp; requests</p>
          </a>
          {/* v8.3 E8.13: ritual de inicio/fin de jornada (equipo, clima, ranking, ganancias, insignias) */}
          <a
            href={`/${safeLocale}/empleado/ritual`}
            className="bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1">
              <Star className="w-4 h-4 text-brand-gold-dark" />
              <span className="font-medium text-sm text-brand-ink">Shift Ritual</span>
            </div>
            <p className="text-xs text-gray-400">Team, weather, ranking &amp; earnings</p>
          </a>
          {/* v8.3 E10.8: consentimiento opcional para reels/insignias públicas */}
          <a
            href={`/${safeLocale}/empleado/marketing`}
            className="bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1">
              <Video className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-sm text-brand-ink">Marketing Consent</span>
            </div>
            <p className="text-xs text-gray-400">Optional — reels &amp; public badges</p>
          </a>
          {/* BC ESA Parte 5.1: reportar ausencia por enfermedad */}
          <a
            href={`/${safeLocale}/empleado/enfermedad`}
            className="bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-state-warning" />
              <span className="font-medium text-sm text-brand-ink">Report Sick Day</span>
            </div>
            <p className="text-xs text-gray-400">Simple reason or medical note</p>
          </a>
          {/* BC ESA s.32: descansos documentados vía tránsito */}
          <a
            href={`/${safeLocale}/empleado/descansos`}
            className="bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-brand-navy" />
              <span className="font-medium text-sm text-brand-ink">My Breaks</span>
            </div>
            <p className="text-xs text-gray-400">Documented rest periods</p>
          </a>
          {/* E7 D.10.7: SOS, near-miss y reporte de incidente laboral */}
          <a
            href={`/${safeLocale}/empleado/seguridad`}
            className="bg-white rounded-xl shadow-elevation-1 p-4 text-left hover:shadow-elevation-2 transition-shadow border border-state-danger/20"
          >
            <div className="flex items-center gap-2 mb-1">
              <AlertOctagon className="w-4 h-4 text-state-danger" />
              <span className="font-medium text-sm text-brand-ink">Safety</span>
            </div>
            <p className="text-xs text-gray-400">SOS, near-miss &amp; injury report</p>
          </a>
        </div>

        {/* Services List */}
        <div>
          <h2 className="text-lg font-semibold text-brand-ink mb-4">
            Today&apos;s Services
          </h2>

          {loadingServices ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
            </div>
          ) : services.length === 0 ? (
            <div className="bg-white rounded-xl shadow-elevation-1 p-8 text-center">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No services assigned for today.</p>
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
                        {svc.serviceSubtype?.replace(/_/g, " ") || "Cleaning"}
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
                      <span>{svc.serviceDate} at {svc.serviceTime}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      <span className="truncate">{svc.address}, {svc.zone}</span>
                    </div>
                    {svc.clientName && (
                      <div className="text-xs text-gray-400">
                        Client: {svc.clientName}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-brand-navy text-sm font-medium mt-3">
                    <span>Open Service</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
