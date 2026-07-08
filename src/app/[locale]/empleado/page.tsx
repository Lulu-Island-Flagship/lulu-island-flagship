"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { EmployeeAuthModal } from "@/components/empleado/EmployeeAuthModal";
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
} from "lucide-react";
import type { EmployeeService } from "@/types";

type JornadaStatus = "not_started" | "started";

export default function EmpleadoPage() {
  const router = useRouter();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authError, setAuthError] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeRole, setEmployeeRole] = useState("");

  const [services, setServices] = useState<EmployeeService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [jornadaStatus, setJornadaStatus] = useState<JornadaStatus>("not_started");
  const [isStartingJornada, setIsStartingJornada] = useState(false);

  // Check auth on mount — verify employee authorization
  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Verify user is an active employee
        const authorized = await verifyEmployee(user.id);
        if (authorized) {
          setIsAuthenticated(true);
          loadEmployeeData();
        } else {
          // Not an authorized employee — sign out and show error
          await supabase.auth.signOut();
          setAuthError("Not authorized — contact your administrator.");
          setShowAuthModal(true);
          setLoadingServices(false);
        }
      } else {
        setShowAuthModal(true);
        setLoadingServices(false);
      }
    }
    checkAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const authorized = await verifyEmployee(session.user.id);
        if (authorized) {
          setIsAuthenticated(true);
          setAuthError("");
          loadEmployeeData();
        } else {
          await supabase.auth.signOut();
          setIsAuthenticated(false);
          setAuthError("Not authorized — contact your administrator.");
          setShowAuthModal(true);
          setServices([]);
          setLoadingServices(false);
        }
      } else {
        setIsAuthenticated(false);
        setServices([]);
        setLoadingServices(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Verify if user_id exists in employees table with is_active = true
  async function verifyEmployee(userId: string | undefined): Promise<boolean> {
    if (!userId) return false;
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .single();
      return !error && !!data;
    } catch {
      return false;
    }
  }

  async function loadEmployeeData() {
    setLoadingServices(true);
    try {
      const res = await fetch("/api/empleado/servicios", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setIsAuthenticated(false);
          setShowAuthModal(true);
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

  // Detect locale from pathname for navigation
  const locale = (typeof window !== "undefined"
    ? window.location.pathname.split("/")[1]
    : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setServices([]);
    setEmployeeName("");
    setJornadaStatus("not_started");
    setAuthError("");
    setShowAuthModal(true);
  };

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

      setJornadaStatus("started");
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
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center">
        {showAuthModal && (
          <EmployeeAuthModal
            onClose={() => setShowAuthModal(false)}
            onError={(msg) => setAuthError(msg)}
          />
        )}
        {authError && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-white rounded-lg shadow-elevation-2 p-4 max-w-sm w-full mx-4">
            <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm text-center">
              {authError}
            </div>
          </div>
        )}
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
                  onClick={() => router.push(`/empleado/servicio/${svc.orderId}`)}
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
