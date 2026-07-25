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
  ChevronRight,
} from "lucide-react";
import type { EmployeeService, AssignmentStatus } from "@/types";
import { haversineDistance, ARRIVAL_GEOFENCE_RADIUS_METERS } from "@/lib/geocode";
import { compressImageToWebP } from "@/lib/image-compress";
import { submitServiceEventOrQueue, submitPhotoOrQueue, triggerSyncCycle } from "@/lib/offline-sync-client";
import { getAllQueuedEvents, planSync, type QueuedServiceEvent } from "@/lib/offline-queue";
import { ChecklistCierre } from "@/components/empleado/ChecklistCierre";
import { UpsellSelector } from "@/components/empleado/UpsellSelector";
import { DiscrepanciaReporter } from "@/components/empleado/DiscrepanciaReporter";
import { CodigoCromatico } from "@/components/empleado/CodigoCromatico";
import { ClosureProtocolPanel } from "@/components/empleado/ClosureProtocolPanel";
import { HoursDisputeButton } from "@/components/empleado/HoursDisputeButton";
import { ErrorBanner } from "@/components/empleado/ErrorBanner";

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

  // Detect locale from route params for navigation -- antes leía
  // window.location.pathname, lo que causaba un hydration mismatch (SSR
  // asumía "en", cliente calculaba el locale real). useParams() da el
  // mismo valor en servidor y cliente porque viene del router de Next.
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";
  const empleadoPath = `/${safeLocale}/empleado`;

  const [service, setService] = useState<EmployeeService | null>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<ServiceLog[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Auditoría UX/seguridad 2026-07-25 (#10): fotos tomadas sin conexión se
  // encolaban (submitPhotoOrQueue) pero desaparecían del timeline visible
  // hasta sincronizar -- el empleado no tenía forma de saber si "ya se
  // guardó" y podía retomar la foto innecesariamente. Ahora se muestra de
  // inmediato una vista previa local (object URL del blob) con badge
  // "pending sync", que se limpia sola cuando refreshQueueStatus() ya no
  // ve eventos de tipo "photo" pendientes para esta orden.
  const [pendingLocalPhotos, setPendingLocalPhotos] = useState<{ id: string; url: string }[]>([]);
  // Feedback visible tras el intento de cada acción -- antes estos fallos
  // (t_in/t_start/t_out, foto, nota) solo se registraban en console.error y
  // el empleado no veía ningún mensaje, quedando sin saber si su toque
  // había funcionado o no.
  const [eventError, setEventError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [noteError, setNoteError] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("timeline");
  const [geofenceStatus, setGeofenceStatus] = useState<"checking" | "inside" | "outside" | "bypass">("checking");
  const [bypassReason, setBypassReason] = useState("");
  // v8.3 E4 fix (auditoría 2026-07-18) — el bypass de geocerca de T_in era
  // instantáneo: un botón habilitado apenas se escribía cualquier texto en
  // el campo de razón, sin foto de evidencia, sin categoría estructurada,
  // y sin ninguna fricción que desincentive el uso reflejo del bypass.
  // Ahora exige las 3 salvaguardas: (1) espera de 120s con countdown
  // visible, (2) foto obligatoria (evidencia de dónde está parado), (3)
  // razón de texto SIEMPRE obligatoria + categoría estructurada (no solo
  // texto libre) para que el supervisor pueda filtrar patrones.
  const BYPASS_WAIT_SECONDS = 120;
  const [bypassCountdown, setBypassCountdown] = useState(BYPASS_WAIT_SECONDS);
  const [bypassCategory, setBypassCategory] = useState<string>("");
  const [bypassPhotoUrl, setBypassPhotoUrl] = useState<string | null>(null);
  const [bypassPhotoUploading, setBypassPhotoUploading] = useState(false);
  const [bypassPhotoError, setBypassPhotoError] = useState("");
  // Auditoría UX/seguridad 2026-07-25 (#4): si el empleado genuinamente no
  // puede tomar la foto de evidencia (cámara rota, cliente pide no
  // fotografiar el interior, etc.), no debe quedar bloqueado sin ninguna
  // salida -- ofrece una justificación escrita en su lugar, que el
  // servidor guarda igual marcada para revisión de supervisor (ver
  // notesWithBypassContext en /api/empleado/servicio).
  const [bypassCannotPhoto, setBypassCannotPhoto] = useState(false);
  const [bypassNoPhotoJustification, setBypassNoPhotoJustification] = useState("");
  // Candado químico (E4, B.2.8): colores confirmados explícitamente en esta
  // sesión de servicio. Vive en el padre porque tanto el tab "Colors" como
  // el checklist lo necesitan.
  const [confirmedColors, setConfirmedColors] = useState<Set<string>>(new Set());
  // v8.3 fix (auditoría 2026-07-15): antes, si el empleado tocaba "Finish
  // Service" sin señal, el evento t_out se encolaba a ciegas (sin validar
  // el Protocolo de Cierre Externo, que requiere red) y la UI cambiaba
  // OPTIMISTAMENTE a "Service Completed" -- el empleado se retiraba
  // creyendo que terminó. Cuando volvía la señal, el servidor rechazaba el
  // t_out una y otra vez (checklist incompleto) hasta agotar los
  // reintentos y pasar a needsManualReview, un estado que NINGÚN
  // componente de UI leía ni mostraba -- el servicio podía quedar
  // "colgado" sin cerrar nunca, sin comunicaciones de cierre, sin entrar a
  // batch-capture, y sin que nadie se enterara. Ahora se muestra el estado
  // real de la cola offline para esta orden.
  const [pendingSyncEvents, setPendingSyncEvents] = useState<QueuedServiceEvent[]>([]);
  const [manualReviewEvents, setManualReviewEvents] = useState<QueuedServiceEvent[]>([]);
  const [retryingSync, setRetryingSync] = useState(false);

  async function refreshQueueStatus() {
    if (!orderId || typeof indexedDB === "undefined") return;
    try {
      const all = await getAllQueuedEvents();
      const forThisOrder = all.filter((e) => e.orderId === orderId);
      const plan = planSync(forThisOrder, new Date().toISOString());
      setPendingSyncEvents([...plan.toSync, ...plan.waiting]);
      setManualReviewEvents(plan.needsManualReview);

      // #10: una vez que ya no hay ningún evento "photo" pendiente para esta
      // orden, asumimos que las fotos locales en preview ya sincronizaron
      // (loadLogs() las trae con su URL real) -- se limpian las previews
      // locales y se liberan sus object URLs.
      const stillHasPendingPhoto = forThisOrder.some((e) => e.eventType === "photo");
      if (!stillHasPendingPhoto) {
        let hadPending = false;
        setPendingLocalPhotos((prev) => {
          if (prev.length === 0) return prev;
          hadPending = true;
          prev.forEach((p) => URL.revokeObjectURL(p.url));
          return [];
        });
        if (hadPending) await loadLogs();
      }
    } catch (e) {
      console.error("Queue status check error:", e);
    }
  }

  useEffect(() => {
    refreshQueueStatus();
    const interval = setInterval(refreshQueueStatus, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Load service details
  useEffect(() => {
    if (!orderId) return;
    loadService();
    loadConfirmedColors();
  }, [orderId]);

  // v8.3 E4 fix (auditoría 2026-07-18): el candado químico ahora persiste
  // server-side (chemical_zone_confirmations, migración 185) — antes vivía
  // solo en este useState y se perdía al refrescar la página, dejando la
  // UI marcando zonas como bloqueadas otra vez aunque el servidor ya las
  // tenía confirmadas (o viceversa, nunca coincidía con lo que el servidor
  // realmente exige en POST /api/empleado/checklist).
  async function loadConfirmedColors() {
    try {
      const res = await fetch(`/api/empleado/chemical-confirm?orderId=${orderId}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setConfirmedColors(new Set<string>(data.confirmedColors || []));
    } catch (e) {
      console.error("Load confirmed colors error:", e);
    }
  }

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
  // geocodificadas de la orden (radio real de "llegada" = 50m, distinto del
  // radio de 200m usado para el punto de encuentro del equipo — ver
  // src/lib/geocode.ts). v8.3 E4 fix (auditoría 2026-07-18): antes, si no
  // había señal GPS o no había coordenadas de referencia, el estado saltaba
  // DIRECTO a "bypass" sin ninguna de las 3 salvaguardas (countdown, foto,
  // razón) — el camino "sin GPS" era, contraintuitivamente, el más fácil de
  // abusar. Ahora los 3 casos (fuera de rango, sin señal, sin referencia)
  // caen todos en "outside" y exigen el mismo flujo de salvaguardas.
  const checkGeofence = async () => {
    setGeofenceStatus("checking");
    const loc = await getCurrentLocation();
    if (!loc) {
      setGeofenceStatus("outside");
      return false;
    }

    if (
      !service ||
      service.addressLat === undefined ||
      service.addressLng === undefined
    ) {
      // Sin coordenadas de referencia: no podemos validar distancia, pero
      // tampoco se confía a ciegas — exige las mismas salvaguardas.
      setGeofenceStatus("outside");
      return false;
    }

    const distance = haversineDistance(
      { lat: loc.lat, lng: loc.lng },
      { lat: service.addressLat, lng: service.addressLng }
    );

    if (distance <= ARRIVAL_GEOFENCE_RADIUS_METERS) {
      setGeofenceStatus("inside");
      return true;
    }

    setGeofenceStatus("outside");
    return false;
  };

  // v8.3 E4 fix (auditoría 2026-07-18): countdown de 120s obligatorio antes
  // de poder confirmar el bypass — arranca apenas se entra en "outside" y
  // se reinicia si se vuelve a "checking"/"inside" (ej. el empleado se
  // movió y ahora sí entra en rango).
  useEffect(() => {
    if (geofenceStatus !== "outside") {
      setBypassCountdown(BYPASS_WAIT_SECONDS);
      return;
    }
    setBypassCountdown(BYPASS_WAIT_SECONDS);
    const interval = setInterval(() => {
      setBypassCountdown((n) => (n > 0 ? n - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofenceStatus]);

  const handleBypassPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orderId) return;

    setBypassPhotoUploading(true);
    setBypassPhotoError("");
    try {
      let blob: Blob;
      try {
        const compressed = await compressImageToWebP(file);
        blob = compressed.blob;
      } catch {
        blob = file;
      }
      const fileName = `${orderId}/geofence-bypass/${Date.now()}.webp`;
      const { error: uploadError } = await supabase.storage
        .from("service-photos")
        .upload(fileName, blob, { contentType: "image/webp" });
      if (uploadError) {
        setBypassPhotoError("No se pudo subir la foto. Intenta de nuevo.");
        return;
      }
      const { data: publicUrlData } = supabase.storage.from("service-photos").getPublicUrl(fileName);
      setBypassPhotoUrl(publicUrlData.publicUrl);
    } catch (err) {
      console.error("Bypass photo upload error:", err);
      setBypassPhotoError("No se pudo subir la foto. Intenta de nuevo.");
    } finally {
      setBypassPhotoUploading(false);
    }
  };

  const bypassSafeguardsReady =
    bypassCountdown === 0 &&
    !!bypassCategory &&
    bypassReason.trim().length > 0 &&
    (bypassCannotPhoto ? bypassNoPhotoJustification.trim().length >= 10 : !!bypassPhotoUrl);

  const confirmBypass = () => {
    if (!bypassSafeguardsReady) return;
    setGeofenceStatus("bypass");
  };

  const handleEvent = async (eventType: EventType) => {
    if (!orderId || isSubmitting) return;

    // For T_in, check geofence first — salvo que el empleado ya haya
    // completado las 3 salvaguardas del bypass (confirmBypass), en cuyo
    // caso NO se vuelve a correr checkGeofence: una nueva lectura de GPS
    // ahí pisaría el estado "bypass" ya confirmado y perdería el trabajo
    // hecho (countdown, foto, razón) sin ninguna ganancia de seguridad
    // real, porque bypassSafeguardsReady ya certifica que se completaron.
    if (eventType === "t_in" && geofenceStatus !== "bypass") {
      const inside = await checkGeofence();
      if (!inside) {
        // Show bypass option
        return;
      }
    }
    if (eventType === "t_in" && geofenceStatus === "bypass" && !bypassSafeguardsReady) {
      // Defensa extra: nunca enviar un bypass sin las 3 salvaguardas
      // completas, aunque el estado ya diga "bypass" por alguna carrera de UI.
      return;
    }

    setIsSubmitting(true);
    setEventError("");

    try {
      const loc = await getCurrentLocation();

      const result = await submitServiceEventOrQueue(orderId, eventType, {
        locationLat: loc?.lat,
        locationLng: loc?.lng,
        ...(eventType === "t_in" && geofenceStatus === "bypass"
          ? {
              geofenceBypass: true,
              geofenceBypassCategory: bypassCategory,
              geofenceBypassReason: bypassReason.trim(),
              ...(bypassCannotPhoto
                ? {
                    geofenceBypassNoPhoto: true,
                    geofenceBypassNoPhotoReason: bypassNoPhotoJustification.trim(),
                  }
                : { photoUrl: bypassPhotoUrl }),
            }
          : {}),
      });

      if (!result.ok) {
        console.error("Service event error:", result.error);
        // "Finish Service" dispara cobro/comunicaciones -- si el POST falla,
        // el empleado debe quedar en un estado explícito de "no se pudo
        // cerrar, reintentar", nunca en limbo silencioso creyendo que ya
        // terminó (el status de la asignación no se toca más abajo, así que
        // el botón "Finish Service" sigue visible para reintentar).
        setEventError(
          result.error ||
            (eventType === "t_out"
              ? "Couldn't close this service. Your progress is saved -- tap Finish Service to try again."
              : "Something went wrong. Please try again.")
        );
        return;
      }

      if (result.queued) {
        // v8.3 fix (auditoría 2026-07-15): T_out ya NO se marca "completed"
        // optimistamente -- el servidor puede rechazarlo (checklist
        // incompleto, protocolo de cierre externo pendiente) y ese rechazo
        // solo se descubre al sincronizar, sin conexión para avisar en el
        // momento. T_in/T_start sí siguen siendo optimistas (D.10 #1): no
        // tienen ninguna validación de negocio que el servidor pueda
        // rechazar más allá de la secuencia, que la propia UI ya respeta.
        const optimisticStatus =
          eventType === "t_in" ? "arrived" : eventType === "t_start" ? "in_progress" : service?.status;
        if (service && optimisticStatus) {
          setService({ ...service, status: optimisticStatus });
        }
        await refreshQueueStatus();
      } else {
        const data = result.data as { assignmentStatus?: AssignmentStatus } | undefined;
        if (service && data?.assignmentStatus) {
          setService({ ...service, status: data.assignmentStatus });
        }
        await loadLogs();
      }
    } catch (e) {
      console.error("Event error:", e);
      setEventError(
        eventType === "t_out"
          ? "Couldn't close this service due to a connection error. Please try again."
          : "Connection error. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orderId) return;

    setUploadingPhoto(true);
    setPhotoError("");

    // #10: vista previa local inmediata, antes de saber si hay red -- así
    // la foto nunca "desaparece" mientras se sube/encola.
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const localPreviewUrl = URL.createObjectURL(file);
    setPendingLocalPhotos((prev) => [...prev, { id: localId, url: localPreviewUrl }]);

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
        setPhotoError(result.error || "Couldn't upload the photo. Please try again.");
        setPendingLocalPhotos((prev) => prev.filter((p) => p.id !== localId));
        URL.revokeObjectURL(localPreviewUrl);
        return;
      }

      if (result.photoUrl && !result.queued) {
        // Subida real inmediata: pasa de "preview local" a foto confirmada
        // y se descarta el object URL local.
        setPhotos((prev) => [...prev, result.photoUrl as string]);
        setPendingLocalPhotos((prev) => prev.filter((p) => p.id !== localId));
        URL.revokeObjectURL(localPreviewUrl);
        await loadLogs();
      }
      // Si result.queued es true (sin red), la preview local se queda
      // marcada "pending sync" hasta que refreshQueueStatus() confirme que
      // ya no quedan eventos "photo" pendientes para esta orden.
    } catch (e) {
      console.error("Photo upload error:", e);
      setPhotoError("Connection error uploading the photo. Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSendNote = async () => {
    if (!noteText.trim() || !orderId) return;

    setIsSubmitting(true);
    setNoteError("");
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
        setNoteError(result.error || "Couldn't send the note. Please try again.");
      }
    } catch (e) {
      console.error("Note error:", e);
      setNoteError("Connection error sending the note. Please try again.");
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

  // v8.3 fix (auditoría 2026-07-15): si ya hay un T_out de esta orden
  // esperando sincronizar (pendiente o en revisión manual), no ofrecer el
  // botón de nuevo -- evita que el empleado lo toque varias veces y
  // encole T_out duplicados mientras espera señal.
  const hasQueuedTOut = [...pendingSyncEvents, ...manualReviewEvents].some((e) => e.eventType === "t_out");
  const nextAction = hasQueuedTOut ? null : getNextAction();

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

        {/* Quick links a paginas por-orden que antes existian pero eran
            inalcanzables: preparacion de llegada, manejo de llaves, chat
            de equipo (D.10.5 / E8.12). */}
        {!isCompleted && (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => router.push(`/${safeLocale}/empleado/servicio/${orderId}/preparacion`)}
              className="bg-white rounded-lg shadow-elevation-1 p-3 text-center hover:shadow-elevation-2 transition-shadow"
            >
              <ClipboardCheck className="w-4 h-4 text-brand-navy mx-auto mb-1" />
              <span className="text-xs font-medium text-brand-ink">Arrival prep</span>
            </button>
            <button
              onClick={() => router.push(`/${safeLocale}/empleado/llaves/${orderId}`)}
              className="bg-white rounded-lg shadow-elevation-1 p-3 text-center hover:shadow-elevation-2 transition-shadow"
            >
              <Home className="w-4 h-4 text-brand-navy mx-auto mb-1" />
              <span className="text-xs font-medium text-brand-ink">Keys</span>
            </button>
            <button
              onClick={() => router.push(`/${safeLocale}/empleado/chat/${orderId}`)}
              className="bg-white rounded-lg shadow-elevation-1 p-3 text-center hover:shadow-elevation-2 transition-shadow"
            >
              <Phone className="w-4 h-4 text-brand-navy mx-auto mb-1" />
              <span className="text-xs font-medium text-brand-ink">Team chat</span>
            </button>
          </div>
        )}

        {/* v8.3 fix (auditoría 2026-07-15): estado real de la cola offline
            para esta orden -- antes invisible por completo. */}
        {manualReviewEvents.length > 0 && (
          <div className="bg-state-danger/10 border border-state-danger rounded-xl p-4 space-y-2">
            <div className="flex items-start gap-2">
              <AlertOctagon className="w-5 h-5 text-state-danger flex-shrink-0 mt-0.5" />
              <div className="text-sm text-state-danger">
                <p className="font-semibold">
                  We couldn&apos;t confirm &quot;{manualReviewEvents[0].eventType.replace(/_/g, " ")}&quot; after several
                  attempts.
                </p>
                {manualReviewEvents[0].lastError && (
                  <p className="mt-1 text-xs">{manualReviewEvents[0].lastError}</p>
                )}
                <p className="mt-1 text-xs">
                  Check your connection and that your closing checklist and photos are complete, then retry. If this
                  keeps failing, contact your supervisor.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                setRetryingSync(true);
                await triggerSyncCycle();
                await refreshQueueStatus();
                await loadService();
                setRetryingSync(false);
              }}
              disabled={retryingSync}
              className="inline-flex items-center gap-2 bg-state-danger text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {retryingSync ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Retry now
            </button>
          </div>
        )}

        {manualReviewEvents.length === 0 && pendingSyncEvents.length > 0 && (
          <div className="bg-state-warning/10 border border-state-warning rounded-xl p-3 flex items-center gap-2 text-sm text-state-warning">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            <span>
              Saved on this device — waiting for connection to confirm &quot;
              {pendingSyncEvents[0].eventType.replace(/_/g, " ")}&quot; with the server.
            </span>
          </div>
        )}

        {/* Action Button (always visible) */}
        {!isCompleted && nextAction && (
          <div className="space-y-2">
            {geofenceStatus === "outside" && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    You appear to be far from the service location (or GPS is unavailable). Bypassing this
                    check is logged and reviewed by your supervisor.
                  </span>
                </div>

                {/* Salvaguarda 1: espera obligatoria de 120s con countdown visible */}
                <div className="text-xs font-medium">
                  {bypassCountdown > 0
                    ? `Please wait ${bypassCountdown}s before you can continue.`
                    : "Wait time complete."}
                </div>

                {/* Salvaguarda 2: categoría estructurada del motivo — flag amarillo estructurado */}
                <select
                  aria-label="Categoría del motivo de bypass de geocerca"
                  value={bypassCategory}
                  onChange={(e) => setBypassCategory(e.target.value)}
                  className="w-full text-sm border border-yellow-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-white"
                >
                  <option value="">Select a reason category (required)...</option>
                  <option value="gps_inaccurate">GPS is inaccurate / weak signal</option>
                  <option value="building_entrance_far">Building entrance is far from the map pin</option>
                  <option value="parking_restriction">Had to park/enter far from exact address</option>
                  <option value="other">Other</option>
                </select>

                {/* Salvaguarda 2b: razón de texto SIEMPRE obligatoria además de la categoría */}
                <input
                  type="text"
                  aria-label="Razón para omitir la verificación de geocerca"
                  value={bypassReason}
                  onChange={(e) => setBypassReason(e.target.value)}
                  placeholder="Describe the specific situation (required)..."
                  className="w-full text-sm border border-yellow-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />

                {/* Salvaguarda 3: foto obligatoria de evidencia -- o, si
                    genuinamente no se puede tomar, una justificación escrita
                    en su lugar (#4, auditoría 2026-07-25). Nunca se omite
                    ambas cosas a la vez. */}
                {!bypassCannotPhoto && (
                  <div>
                    {bypassPhotoUrl ? (
                      <img src={bypassPhotoUrl} alt="Bypass evidence" className="w-20 h-20 rounded-lg object-cover" />
                    ) : (
                      <label className="inline-flex items-center gap-2 text-xs font-medium bg-white border border-yellow-300 rounded-lg px-3 py-2 cursor-pointer hover:bg-yellow-100">
                        {bypassPhotoUploading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Camera className="w-4 h-4" />
                        )}
                        <span>Add evidence photo (required)</span>
                        <input
                          type="file"
                          aria-label="Foto de evidencia obligatoria para el bypass de geocerca"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={handleBypassPhotoUpload}
                          disabled={bypassPhotoUploading}
                        />
                      </label>
                    )}
                    {bypassPhotoError && <p className="text-xs text-red-600 mt-1">{bypassPhotoError}</p>}
                    {!bypassPhotoUrl && (
                      <button
                        type="button"
                        onClick={() => setBypassCannotPhoto(true)}
                        className="mt-2 block text-xs underline text-yellow-800"
                      >
                        I can&apos;t take a photo
                      </button>
                    )}
                  </div>
                )}

                {bypassCannotPhoto && (
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-yellow-800">
                      Explain why you can&apos;t take a photo (required, flagged for supervisor review)
                    </label>
                    <textarea
                      aria-label="Justificación por no poder tomar foto de evidencia"
                      value={bypassNoPhotoJustification}
                      onChange={(e) => setBypassNoPhotoJustification(e.target.value)}
                      placeholder="e.g. camera not working, client asked not to photograph the interior..."
                      rows={2}
                      className="w-full text-sm border border-yellow-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setBypassCannotPhoto(false);
                        setBypassNoPhotoJustification("");
                      }}
                      className="text-xs underline text-yellow-800"
                    >
                      Actually, let me take a photo
                    </button>
                  </div>
                )}

                <button
                  onClick={confirmBypass}
                  disabled={!bypassSafeguardsReady}
                  className="text-xs underline font-medium disabled:opacity-50 disabled:no-underline"
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
            <ErrorBanner
              message={eventError}
              onRetry={() => handleEvent(nextAction.type)}
              retrying={isSubmitting}
            />
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
          {/* Tab bar -- #18: scrollbar-hide oculta el scrollbar nativo pero
              nada indicaba que hubiera más pestañas fuera de pantalla. Se
              agrega un degradado a la derecha (siempre visible salvo que la
              última pestaña ya esté activa/visible) como affordance visual
              de "hay más contenido", sin restructurar la navegación. */}
          <div className="relative">
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
            {activeTab !== tabs[tabs.length - 1].key && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent flex items-center justify-end"
              >
                <ChevronRight className="w-3.5 h-3.5 text-gray-400 mr-0.5" />
              </div>
            )}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === "timeline" && (
              <div className="space-y-4">
                {/* Photos */}
                {(photos.length > 0 || pendingLocalPhotos.length > 0) && (
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((url, i) => (
                      <img key={i} src={url} alt={`Photo ${i + 1}`} className="rounded-lg aspect-square object-cover" />
                    ))}
                    {/* #10: previas locales de fotos aún sin sincronizar --
                        visibles de inmediato con badge, para que el
                        empleado no crea que se perdieron y las retome. */}
                    {pendingLocalPhotos.map((p) => (
                      <div key={p.id} className="relative">
                        <img
                          src={p.url}
                          alt="Photo pending sync"
                          className="rounded-lg aspect-square object-cover opacity-80"
                        />
                        <span className="absolute bottom-1 left-1 right-1 bg-black/70 text-white text-[10px] font-medium text-center rounded px-1 py-0.5 flex items-center justify-center gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          Pending sync
                        </span>
                      </div>
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
                      aria-label="Agregar foto del servicio"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handlePhotoUpload}
                      disabled={uploadingPhoto}
                    />
                  </label>
                )}
                <ErrorBanner message={photoError} />

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
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium capitalize">
                              {log.event_type.replace(/_/g, " ")}
                            </span>
                            <span className="text-xs text-gray-400">{formatTime(log.timestamp)}</span>
                            {["t_in", "t_start", "t_out"].includes(log.event_type) && (
                              <HoursDisputeButton
                                orderId={orderId}
                                eventType={log.event_type as "t_in" | "t_start" | "t_out"}
                                eventLabel={log.event_type.replace(/_/g, " ")}
                                recordedTimestamp={log.timestamp}
                              />
                            )}
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
                  <div className="pt-2 border-t space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        aria-label="Agregar una nota al servicio"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Add a note..."
                        className="flex-1 text-sm border rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none"
                        onKeyDown={(e) => e.key === "Enter" && handleSendNote()}
                      />
                      <button
                        aria-label="Enviar nota"
                        onClick={handleSendNote}
                        disabled={!noteText.trim() || isSubmitting}
                        className="p-2 bg-brand-navy text-white rounded-lg disabled:opacity-50"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                    <ErrorBanner message={noteError} onRetry={handleSendNote} retrying={isSubmitting} />
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
                <ClosureProtocolPanel orderId={orderId} noSmartphoneFlow={!!service?.noSmartphoneFlow} />
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
                  Reference only — the real chemical lock happens per zone in the Checklist tab, where
                  you must identify the correct product without the answer shown. Never mix RED (acid)
                  with BLUE (ammonia) — chlorine gas risk.
                </p>
                <CodigoCromatico confirmedColors={confirmedColors} />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
