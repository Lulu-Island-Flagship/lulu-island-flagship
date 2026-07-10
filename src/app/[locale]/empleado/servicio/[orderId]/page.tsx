"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  ChevronLeft,
  MapPin,
  Clock,
  Home,
  Camera,
  CheckCircle2,
  Play,
  Flag,
  Loader2,
  Send,
  Phone,
  User,
  AlertTriangle,
  ClipboardCheck,
  Tag,
  AlertOctagon,
  Palette,
} from "lucide-react";
import type { EmployeeService, AssignmentStatus } from "@/types";
import { haversineDistance, GEOFENCE_RADIUS_METERS } from "@/lib/geocode";
import { submitServiceEventOrQueue, submitPhotoOrQueue } from "@/lib/offline-sync-client";
import { ChecklistCierre } from "@/components/empleado/ChecklistCierre";
import { UpsellSelector } from "@/components/empleado/UpsellSelector";
import { DiscrepanciaReporter } from "@/components/empleado/DiscrepanciaReporter";
import { CodigoCromático } from "@/components/empleado/CodigoCromático";
import { ClosureProtocolPanel } from "@/components/empleado/ClosureProtocolPanel";

type EventType = "t_in" | "t_start" | "t_out" | "photo" | "note";

type TabKey = "timeline" | "checklist" | "upsell" | "discrepancia" | "cromático";

interface ServiceLog {
  id: string;
  event_type: string;
  timestamp: string;
  photo_url?: string;
  notes?: string;
  location_lat?: number;
  location_lng?: number;
}

export default function ServicioPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params?.orderId as string;

  // Detect locale from pathname for navigation
  const locale = (typeof window !== "undefined"
    ? window.location.pathname.split("/")[1]
    : "en") as string;
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
  const empleadoPath = `/${safeLocale}/empleado`;

  const [service, setService] = useState<EmployeeService | null>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<ServiceLog[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("timeline");
  const [geofenceStatus, setGeofenceStatus] = useState<"checking" | "inside" | "outside" | "bypass">("checking");
  const [bypassReason, setBypassReason] = useState("");
  // Candado químico (E4, B.2.8): colores confirmados explícitamente en esta
  // sesión de servicio. Vive en el padre porque tanto el tab "Colors" como
  // el checklist lo necesitan.
  const [confirmedColors, setConfirmedColors] = useState<Set<string>>(new Set());

  // Load service details
  useEffect(() => {
    if (!orderId) return;
    loadService();
  }, [orderId]);

  async function loadService() {
    setLoading(true);
    try {
      // Usar endpoint directo para evitar cargar todos los servicios
      const res = await fetch(`/api/empleado/servicio/${orderId}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) router.push(empleadoPath);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (data.service) {
        setService(data.service);
        await loadLogs();
      }
    } catch (e) {
      console.error("Load service error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs() {
    if (!orderId) return;
    try {
      const { data, error } = await supabase
        .from("service_logs")
        .select("id, event_type, timestamp, photo_url, notes, location_lat, location_lng")
        .eq("order_id", orderId)
        .order("timestamp", { ascending: true });

      if (!error && data) {
        setLogs(data);
      }
    } catch (e) {
      console.error("Load logs error:", e);
    }
  }

  const getCurrentLocation = (): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 10000, enableHighAccuracy: true }
      );
    });
  };

  // Geocerca real: compara la ubicación del empleado con las coordenadas
  // geocodificadas de la orden. Si no hay coordenadas o falla el GPS,
  // permite bypass manual con advertencia (fallback operacional).
  const checkGeofence = async () => {
    setGeofenceStatus("checking");
    const loc = await getCurrentLocation();
    if (!loc) {
      setGeofenceStatus("bypass");
      return false;
    }

    if (
      !service ||
      service.addressLat === undefined ||
      service.addressLng === undefined
    ) {
      // Sin coordenadas de referencia: no podemos validar distancia.
      setGeofenceStatus("bypass");
      return false;
    }

    const distance = haversineDistance(
      { lat: loc.lat, lng: loc.lng },
      { lat: service.addressLat, lng: service.addressLng }
    );

    if (distance <= GEOFENCE_RADIUS_METERS) {
      setGeofenceStatus("inside");
      return true;
    }

    setGeofenceStatus("outside");
    return false;
  };

  const handleEvent = async (eventType: EventType) => {
    if (!orderId || isSubmitting) return;

    // For T_in, check geofence first
    if (eventType === "t_in") {
      const inside = await checkGeofence();
      if (!inside && geofenceStatus !== "bypass") {
        // Show bypass option
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const loc = await getCurrentLocation();

      // Si hay bypass de geocerca, registrar nota de auditoría (encola si no hay señal)
      if (eventType === "t_in" && geofenceStatus === "bypass" && bypassReason.trim()) {
        await submitServiceEventOrQueue(orderId, "note", {
          notes: `Geofence bypass: ${bypassReason.trim()}`,
        });
      }

      const result = await submitServiceEventOrQueue(orderId, eventType, {
        locationLat: loc?.lat,
        locationLng: loc?.lng,
      });

      if (!result.ok) {
        console.error("Service event error:", result.error);
        return;
      }

      if (result.queued) {
        // Sin señal: actualizamos el estado local de forma optimista (D.10 #1
        // "no bloqueante") — el servidor confirmará cuando sincronice.
        const optimisticStatus =
          eventType === "t_in" ? "arrived" : eventType === "t_start" ? "in_progress" : eventType === "t_out" ? "completed" : service?.status;
        if (service && optimisticStatus) {
          setService({ ...service, status: optimisticStatus });
        }
      } else {
        const data = result.data as { assignmentStatus?: AssignmentStatus } | undefined;
        if (service && data?.assignmentStatus) {
          setService({ ...service, status: data.assignmentStatus });
        }
        await loadLogs();
      }
    } catch (e) {
      console.error("Event error:", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orderId) return;

    setUploadingPhoto(true);
    try {
      const loc = await getCurrentLocation();
      // Comprime a WebP (E4.12) y sube; si no hay señal, queda encolada
      // silenciosamente (D.10 #1) — no se pierde la evidencia.
      const result = await submitPhotoOrQueue(orderId, file, {
        locationLat: loc?.lat,
        locationLng: loc?.lng,
      });

      if (!result.ok) {
        console.error("Photo upload error:", result.error);
        return;
      }

      if (result.photoUrl) {
        setPhotos((prev) => [...prev, result.photoUrl as string]);
      }
      if (!result.queued) {
        await loadLogs();
      }
    } catch (e) {
      console.error("Photo upload error:", e);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSendNote = async () => {
    if (!noteText.trim() || !orderId) return;

    setIsSubmitting(true);
    try {
      // Mismo patrón offline-first que T_in/T_start/T_out: si no hay señal,
      // la nota se encola en vez de perderse.
      const result = await submitServiceEventOrQueue(orderId, "note", {
        notes: noteText.trim(),
      });

      if (result.ok) {
        setNoteText("");
        if (!result.queued) {
          await loadLogs();
        }
      } else {
        console.error("Note error:", result.error);
      }
    } catch (e) {
      console.error("Note error:", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getNextAction = () => {
    if (!service) return null;
    switch (service.status) {
      case "pending":
      case "en_route":
        return { type: "t_in" as EventType, label: "I Arrived", icon: MapPin, color: "bg-state-success text-white" };
      case "arrived":
        return { type: "t_start" as EventType, label: "Start Cleaning", icon: Play, color: "bg-brand-navy text-white" };
      case "in_progress":
        return { type: "t_out" as EventType, label: "Finish Service", icon: Flag, color: "bg-state-success text-white" };
      default:
        return null;
    }
  };

  const nextAction = getNextAction();

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "timeline", label: "Timeline", icon: Clock },
    { key: "checklist", label: "Checklist", icon: ClipboardCheck },
    { key: "upsell", label: "Upsell", icon: Tag },
    { key: "discrepancia", label: "Issue", icon: AlertOctagon },
    { key: "cromático", label: "Colors", icon: Palette },
  ];

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </main>
    );
  }

  if (!service) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center">
          <AlertTriangle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-brand-ink mb-2">Service Not Found</h2>
          <p className="text-sm text-gray-500 mb-4">This service is not assigned to you.</p>
          <button
            onClick={() => router.push(empleadoPath)}
            className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg font-semibold"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>
      </main>
    );
  }

  const isCompleted = service.status === "completed";

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.push(`/${safeLocale}/empleado`)} className="text-white/70 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm truncate capitalize">
              {service.serviceSubtype?.replace(/_/g, " ") || "Cleaning Service"}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Client Brief Card */}
        <div className="bg-white rounded-xl shadow-elevation-1 p-5 space-y-4">
          <h2 className="font-semibold text-brand-ink">Client Brief</h2>

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-gold" />
              <span>{service.serviceDate} at {service.serviceTime}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-brand-gold" />
              <span>{service.address}, {service.zone}</span>
            </div>
            {service.clientName && (
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-brand-gold" />
                <span>{service.clientName}</span>
              </div>
            )}
            {service.clientPhone && (
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-brand-gold" />
                <a href={`tel:${service.clientPhone}`} className="text-brand-navy underline">
                  {service.clientPhone}
                </a>
              </div>
            )}
          </div>

          <div className="border-t pt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
            <div className="flex items-center gap-1">
              <Home className="w-3.5 h-3.5" />
              <span>{service.bedrooms} bed, {service.bathrooms} bath</span>
            </div>
            <div>
              <span>{service.squareFeet} ft²</span>
            </div>
            {service.petsCount > 0 && (
              <div className="col-span-2 text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                {service.petsCount} pet(s): {service.petsType}
              </div>
            )}
            {service.residents > 0 && (
              <div className="col-span-2">
                {service.residents} resident(s)
              </div>
            )}
          </div>
        </div>

        {/* Action Button (always visible) */}
        {!isCompleted && nextAction && (
          <div className="space-y-2">
            {geofenceStatus === "outside" && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>You appear to be far from the service location. GPS may be inaccurate.</span>
                </div>
                <input
                  type="text"
                  value={bypassReason}
                  onChange={(e) => setBypassReason(e.target.value)}
                  placeholder="Reason for bypass (required)..."
                  className="w-full text-sm border border-yellow-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                <button
                  onClick={() => {
                    if (!bypassReason.trim()) return;
                    setGeofenceStatus("bypass");
                  }}
                  disabled={!bypassReason.trim()}
                  className="text-xs underline font-medium disabled:opacity-50"
                >
                  I am at the location — continue anyway
                </button>
              </div>
            )}
            <button
              onClick={() => handleEvent(nextAction.type)}
              disabled={isSubmitting}
              className={`w-full py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${nextAction.color}`}
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <nextAction.icon className="w-5 h-5" />
                  {nextAction.label}
                </>
              )}
            </button>
          </div>
        )}

        {isCompleted && (
          <div className="bg-state-success/10 text-state-success rounded-xl p-5 text-center">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
            <p className="font-semibold">Service Completed</p>
            <p className="text-sm mt-1">Great work! This service is finished.</p>
            <button
              onClick={() => router.push(empleadoPath)}
              className="mt-4 inline-flex items-center gap-2 bg-state-success text-white px-4 py-2 rounded-lg font-medium"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to Dashboard
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-elevation-1 overflow-hidden">
          {/* Tab bar */}
          <div className="flex overflow-x-auto border-b scrollbar-hide">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1 px-3 py-3 text-xs font-medium whitespace-nowrap transition-colors ${
                    activeTab === tab.key
                      ? "text-brand-navy border-b-2 border-brand-navy bg-brand-navy/5"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === "timeline" && (
              <div className="space-y-4">
                {/* Photos */}
                {photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((url, i) => (
                      <img key={i} src={url} alt={`Photo ${i + 1}`} className="rounded-lg aspect-square object-cover" />
                    ))}
                  </div>
                )}

                {/* Photo Upload */}
                {!isCompleted && (
                  <label className="w-full bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg py-3 flex items-center justify-center gap-2 text-gray-600 font-medium cursor-pointer hover:border-brand-gold transition-colors">
                    {uploadingPhoto ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Camera className="w-4 h-4" />
                        Add Photo
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handlePhotoUpload}
                      disabled={uploadingPhoto}
                    />
                  </label>
                )}

                {/* Timeline */}
                {logs.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No events yet.</p>
                ) : (
                  <div className="space-y-3">
                    {logs.map((log) => (
                      <div key={log.id} className="flex items-start gap-3">
                        <div className="mt-0.5">
                          {log.event_type === "t_in" && <MapPin className="w-4 h-4 text-state-success" />}
                          {log.event_type === "t_start" && <Play className="w-4 h-4 text-brand-navy" />}
                          {log.event_type === "t_out" && <Flag className="w-4 h-4 text-state-success" />}
                          {log.event_type === "photo" && <Camera className="w-4 h-4 text-brand-gold" />}
                          {log.event_type === "note" && <AlertTriangle className="w-4 h-4 text-gray-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium capitalize">
                              {log.event_type.replace(/_/g, " ")}
                            </span>
                            <span className="text-xs text-gray-400">{formatTime(log.timestamp)}</span>
                          </div>
                          {log.notes && (
                            <p className="text-xs text-gray-600 mt-0.5">{log.notes}</p>
                          )}
                          {log.photo_url && (
                            <img
                              src={log.photo_url}
                              alt="Service photo"
                              className="mt-2 rounded-lg w-full max-h-40 object-cover"
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Note */}
                {!isCompleted && (
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <input
                      type="text"
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add a note..."
                      className="flex-1 text-sm border rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                      onKeyDown={(e) => e.key === "Enter" && handleSendNote()}
                    />
                    <button
                      onClick={handleSendNote}
                      disabled={!noteText.trim() || isSubmitting}
                      className="p-2 bg-brand-navy text-white rounded-lg disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === "checklist" && (
              <div className="space-y-4">
                <ChecklistCierre
                  orderId={orderId}
                  serviceSubtype={service.serviceSubtype || "regular"}
                  confirmedColors={confirmedColors}
                  onConfirmedColorsChange={setConfirmedColors}
                />
                <ClosureProtocolPanel orderId={orderId} />
              </div>
            )}

            {activeTab === "upsell" && (
              <UpsellSelector orderId={orderId} onUpsellAdded={() => {}} />
            )}

            {activeTab === "discrepancia" && (
              <DiscrepanciaReporter orderId={orderId} onReported={() => setActiveTab("timeline")} />
            )}

            {activeTab === "cromático" && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Confirm each chemical before using it. Match color, icon, AND text — never rely on color alone
                  (colorblindness safeguard). Never mix RED (acid) with BLUE (ammonia) — chlorine gas risk.
                </p>
                <CodigoCromático
                  confirmedColors={confirmedColors}
                  onConfirmedColorsChange={setConfirmedColors}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
