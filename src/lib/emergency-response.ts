"use client";

/**
 * v8.3 E4 — C.7: Protocolo de Emergencia Personal (flujo post-Safety Abort).
 *
 * WorkSafeBC BC OHS 4.22 (trabajo en aislamiento): cuando un empleado activa
 * el Safety Abort, el sistema debe ofrecer acciones de emergencia inmediatas,
 * mantener GPS en tiempo real por un canal prioritario, notificar al admin
 * por push+SMS+email simultáneos, y —si el admin no responde en 2 minutos—
 * escalar automáticamente al contacto de emergencia registrado del empleado.
 *
 * Conecta con:
 * - src/lib/safety-abort.ts: constantes de escalación (SOS_ADMIN_CALL_MINUTES),
 *   etapas de SafetyAbortStage, funciones puras de escalación.
 * - src/components/empleado/SafetyAbortButton.tsx: usa EmergencyAction como
 *   catálogo de acciones visibles en la UI post-abort.
 *
 * @module emergency-response
 */

import { z } from "zod";
import {
  SOS_ADMIN_CALL_MINUTES,
//   type SafetyAbortStage,
//   type _SafetyAbortEscalationResult,
} from "@/lib/safety-abort";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canal Realtime prioritario para GPS de emergencia.
 * Separado del heartbeat normal (pwa-heartbeat-alerts) porque en una
 * emergencia activa el GPS debe enviarse con máxima frecuencia y sin
 * competir con tráfico no crítico.
 */
export const EMERGENCY_GPS_CHANNEL = "emergency-gps";

/** Intervalo de envío de GPS durante una emergencia activa (milisegundos). */
export const EMERGENCY_GPS_INTERVAL_MS = 5000; // 5 segundos — tiempo real

/** Timer de respuesta del admin antes de escalar al contacto de emergencia. */
export const ADMIN_RESPONSE_TIMER_MINUTES = SOS_ADMIN_CALL_MINUTES; // 2 minutos

/** Severidad de la alerta unificada para emergencias personales. */
export const EMERGENCY_ALERT_SEVERITY = "p0_safety" as const;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * Catálogo de acciones de emergencia visibles en la PWA post-Safety Abort.
 *
 * WorkSafeBC BC OHS 4.22 exige que el trabajador aislado tenga acceso
 * inmediato a servicios de emergencia sin depender del admin. Este enum
 * es el contrato entre la UI (SafetyAbortButton.tsx) y la lógica de
 * respuesta (este módulo).
 */
export const EmergencyActionSchema = z.enum([
  "call_ambulance",   // 🚑 — llama a servicios médicos de emergencia
  "call_police",      // 👮 — llama a la policía
  "exit_property",    // 🏠 — instrucciones para salir de la propiedad de forma segura
  "call_me",          // 📞 — solicita que el admin lo llame de inmediato
]);

/** Tipo de acción de emergencia seleccionada por el empleado. */
export type EmergencyAction = z.infer<typeof EmergencyActionSchema>;

/** Etiquetas y emojis para la UI, por acción. */
export const EMERGENCY_ACTION_LABELS: Record<EmergencyAction, { emoji: string; labelKey: string }> = {
  call_ambulance: { emoji: "🚑", labelKey: "callAmbulance" },
  call_police: { emoji: "👮", labelKey: "callPolice" },
  exit_property: { emoji: "🏠", labelKey: "exitProperty" },
  call_me: { emoji: "📞", labelKey: "callMe" },
};

/** Datos de ubicación GPS en una emergencia activa. */
export const EmergencyGpsUpdateSchema = z.object({
  safety_abort_id: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().positive().nullable(),
  timestamp_iso: z.string().datetime({ offset: true }),
  /** Acción seleccionada por el empleado en la UI si ya eligió una. */
  selected_action: EmergencyActionSchema.nullable(),
});

/** Tipo inferido de la actualización GPS de emergencia. */
export type EmergencyGpsUpdate = z.infer<typeof EmergencyGpsUpdateSchema>;

/** Estado del flujo de respuesta post-abort. */
export const EmergencyResponseStateSchema = z.object({
  safety_abort_id: z.string(),
  /** Timestamp de activación del SOS (hereda de safety-abort.ts). */
  sos_started_at_iso: z.string().datetime({ offset: true }),
  /** Etapa actual de la cadena de escalación. */
  stage: z.enum([
    "awaiting_action",      // PWA esperando que el empleado elija acción
    "action_selected",      // empleado eligió 🚑👮🏠📞
    "notifying_admin",      // push+SMS+email enviados
    "admin_responding",     // timer de 2 min corriendo
    "admin_acknowledged",   // admin respondió antes del timeout
    "escalated_to_contact", // timeout: escalado al contacto de emergencia
  ]),
  /** Acción seleccionada por el empleado (si ya eligió). */
  selected_action: EmergencyActionSchema.nullable(),
  /** Última ubicación GPS conocida. */
  last_gps: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .nullable(),
  /** Timestamps de la cadena de notificación. */
  notifications: z.object({
    push_sent_at_iso: z.string().datetime({ offset: true }).nullable(),
    sms_sent_at_iso: z.string().datetime({ offset: true }).nullable(),
    email_sent_at_iso: z.string().datetime({ offset: true }).nullable(),
  }),
  /** Timestamp del ack del admin (null hasta que responda). */
  admin_acknowledged_at_iso: z.string().datetime({ offset: true }).nullable(),
  /** Timestamp de escalación al contacto de emergencia. */
  escalated_at_iso: z.string().datetime({ offset: true }).nullable(),
});

/** Tipo inferido del estado de respuesta de emergencia. */
export type EmergencyResponseState = z.infer<typeof EmergencyResponseStateSchema>;

/**
 * Datos del contacto de emergencia del empleado, usados en la escalación
 * automática si el admin no responde en 2 minutos.
 *
 * WorkSafeBC: el empleador está legalmente obligado a mantener un contacto
 * de emergencia actualizado para cada trabajador que opera en aislamiento.
 */
export const EmergencyContactSchema = z.object({
  nombre: z.string().min(1),
  telefono: z.string().min(1),
  relacion: z.string().min(1),
  email: z.string().email().nullable(),
  idioma: z.string().nullable(),
});

/** Tipo inferido del contacto de emergencia. */
export type EmergencyContact = z.infer<typeof EmergencyContactSchema>;

/** Input para la notificación simultánea push+SMS+email al admin. */
export const EmergencyNotificationInputSchema = z.object({
  safety_abort_id: z.string(),
  employee_name: z.string().min(1),
  employee_phone: z.string().nullable(),
  gps_lat: z.number(),
  gps_lng: z.number(),
  selected_action: EmergencyActionSchema.nullable(),
  admin_phone: z.string().min(1),
  admin_email: z.string().email(),
  /** URL del mapa con la ubicación GPS. */
  map_url: z.string().url().nullable(),
});

/** Tipo inferido del input de notificación. */
export type EmergencyNotificationInput = z.infer<typeof EmergencyNotificationInputSchema>;

// ---------------------------------------------------------------------------
// GPS prioritario en tiempo real
// ---------------------------------------------------------------------------

let emergencyGpsIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Obtiene la posición GPS actual con alta precisión para contexto de emergencia.
 * A diferencia de pwa-heartbeat.ts, aquí se usa enableHighAccuracy=true y
 * un timeout más corto — en una emergencia, la ubicación precisa es crítica.
 */
function getEmergencyPosition(): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
    );
  });
}

/**
 * Publica una actualización de GPS en el canal prioritario de emergencia.
 *
 * WorkSafeBC BC OHS 4.22: en una emergencia activa, el GPS debe enviarse
 * en tiempo real — no vale esperar al próximo ciclo de sync offline.
 * Este canal es independiente del heartbeat normal.
 *
 * @param safetyAbortId - ID del Safety Abort activo.
 * @param selectedAction - Acción seleccionada por el empleado (si ya eligió).
 */
export async function publishEmergencyGps(
  safetyAbortId: string,
  selectedAction: EmergencyAction | null
): Promise<void> {
  const pos = await getEmergencyPosition();

  const update: EmergencyGpsUpdate = EmergencyGpsUpdateSchema.parse({
    safety_abort_id: safetyAbortId,
    lat: pos?.lat ?? 0,
    lng: pos?.lng ?? 0,
    accuracy_m: pos?.accuracy ?? null,
    timestamp_iso: new Date().toISOString(),
    selected_action: selectedAction,
  });

  await supabase.channel(EMERGENCY_GPS_CHANNEL).send({
    type: "broadcast",
    event: "emergency_gps_update",
    payload: update,
  });
}

/**
 * Arranca el envío continuo de GPS por el canal prioritario de emergencia.
 *
 * - Envía inmediatamente al iniciar.
 * - Luego repite cada EMERGENCY_GPS_INTERVAL_MS (5 segundos).
 * - Idempotente: detiene cualquier intervalo previo antes de arrancar.
 *
 * @param safetyAbortId - ID del Safety Abort activo.
 * @param selectedAction - Acción seleccionada por el empleado.
 */
export function startEmergencyGps(
  safetyAbortId: string,
  selectedAction: EmergencyAction | null
): void {
  if (typeof window === "undefined") return;

  stopEmergencyGps();

  void publishEmergencyGps(safetyAbortId, selectedAction);

  emergencyGpsIntervalId = setInterval(() => {
    void publishEmergencyGps(safetyAbortId, selectedAction);
  }, EMERGENCY_GPS_INTERVAL_MS);
}

/**
 * Detiene el envío de GPS de emergencia. Seguro llamar aunque no esté corriendo.
 */
export function stopEmergencyGps(): void {
  if (emergencyGpsIntervalId !== null) {
    clearInterval(emergencyGpsIntervalId);
    emergencyGpsIntervalId = null;
  }
}

/**
 * Suscribe al admin (Command Center) a las actualizaciones de GPS de
 * emergencia en tiempo real.
 *
 * @param onGpsUpdate - Callback que recibe cada actualización GPS.
 * @returns Función para desuscribirse.
 */
export function subscribeToEmergencyGps(
  onGpsUpdate: (update: EmergencyGpsUpdate) => void
): () => void {
  const channel = supabase.channel(EMERGENCY_GPS_CHANNEL);

  channel.on("broadcast", { event: "emergency_gps_update" }, (event) => {
    const parsed = EmergencyGpsUpdateSchema.safeParse(event.payload);
    if (parsed.success) {
      onGpsUpdate(parsed.data);
    }
  });

  void channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

// ---------------------------------------------------------------------------
// Notificación simultánea: push + SMS + email
// ---------------------------------------------------------------------------

/**
 * Envía las tres notificaciones al admin simultáneamente (Promise.allSettled):
 * - Push: vía Supabase Realtime (canal emergency-admin-alerts).
 * - SMS: vía src/lib/sms.ts (sendSms).
 * - Email: vía src/lib/email.ts (sendEmail).
 *
 * WorkSafeBC BC OHS 4.22: la notificación debe ser simultánea por múltiples
 * canales para maximizar la probabilidad de que el admin reciba al menos uno
 * en el menor tiempo posible. Si un canal falla (ej. proveedor SMS no
 * configurado), los otros dos siguen — ninguno bloquea al resto.
 *
 * @param input - Datos completos de la notificación de emergencia.
 * @returns Resumen de qué canales se enviaron y cuáles fallaron.
 */
export async function sendEmergencyNotifications(
  input: EmergencyNotificationInput
): Promise<{
  push: { sent: boolean; error?: string };
  sms: { sent: boolean; error?: string };
  email: { sent: boolean; error?: string };
}> {
  const mapUrl =
    input.map_url ??
    `https://www.google.com/maps?q=${input.gps_lat},${input.gps_lng}`;

  const actionLabel =
    input.selected_action
      ? EMERGENCY_ACTION_LABELS[input.selected_action].emoji
      : "emergencia";

  const alertMessage = [
    `🚨 EMERGENCIA ACTIVA — ${input.employee_name}`,
    `Acción: ${actionLabel}`,
    `Ubicación: ${mapUrl}`,
    `Tel empleado: ${input.employee_phone ?? "no registrado"}`,
    `Timer admin: ${ADMIN_RESPONSE_TIMER_MINUTES} min para responder.`,
    `Si no responde → escala a contacto de emergencia.`,
  ].join("\n");

  // 1. Push notification vía Supabase Realtime
  const pushPromise = supabase
    .channel("emergency-admin-alerts")
    .send({
      type: "broadcast",
      event: "emergency_activated",
      payload: {
        safety_abort_id: input.safety_abort_id,
        title: `🚨 SOS: ${input.employee_name}`,
        body: alertMessage,
        map_url: mapUrl,
        severity: EMERGENCY_ALERT_SEVERITY,
      },
    })
    .then(() => ({ sent: true }))
    .catch((err: Error) => ({ sent: false, error: err.message }));

  // 2. SMS — usa src/lib/sms.ts (carga dinámica para evitar dependencia circular)
  const smsPromise = import("@/lib/sms")
    .then(({ sendSms }) =>
      sendSms({
        phoneNumber: input.admin_phone,
        body: alertMessage,
      })
    )
    .then((result) =>
      result.status === "sent"
        ? { sent: true }
        : { sent: false, error: result.status }
    )
    .catch((err: Error) => ({ sent: false, error: err.message }));

  // 3. Email — usa src/lib/email.ts (carga dinámica)
  const emailPromise = import("@/lib/email")
    .then(({ sendEmail }) =>
      sendEmail({
        toEmail: input.admin_email,
        subject: `🚨 SOS EMERGENCIA: ${input.employee_name}`,
        body: alertMessage.replace(/\n/g, "<br>"),
      })
    )
    .then((result) =>
      result.status === "sent" ? { sent: true } : { sent: false, error: result.status }
    )
    .catch((err: Error) => ({ sent: false, error: err.message }));

  const [push, sms, email] = await Promise.allSettled([
    pushPromise,
    smsPromise,
    emailPromise,
  ]);

  return {
    push: push.status === "fulfilled" ? push.value : { sent: false, error: "promise rejected" },
    sms: sms.status === "fulfilled" ? sms.value : { sent: false, error: "promise rejected" },
    email: email.status === "fulfilled" ? email.value : { sent: false, error: "promise rejected" },
  };
}

// ---------------------------------------------------------------------------
// Timer de respuesta admin + escalación al contacto de emergencia
// ---------------------------------------------------------------------------

/**
 * Evalúa si el admin ya excedió el timer de respuesta (2 minutos).
 *
 * WorkSafeBC BC OHS 4.22: si el empleador (admin) no responde en 2 minutos,
 * el sistema debe escalar automáticamente al contacto de emergencia del
 * empleado. La seguridad humana no puede depender de que alguien esté mirando
 * la pantalla.
 *
 * @param sosStartedAtIso - Timestamp de activación del SOS.
 * @param nowIso - Timestamp actual (inyectado para testeabilidad).
 * @param adminAcknowledgedAtIso - Timestamp del ack del admin (null si no respondió).
 * @returns true si el admin NO respondió y ya pasaron los 2 minutos.
 */
export function hasAdminResponseTimedOut(
  sosStartedAtIso: string,
  nowIso: string,
  adminAcknowledgedAtIso: string | null
): boolean {
  if (adminAcknowledgedAtIso) return false; // el admin ya respondió

  const started = new Date(sosStartedAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const elapsedMinutes = (now - started) / (1000 * 60);

  return elapsedMinutes >= ADMIN_RESPONSE_TIMER_MINUTES;
}

/**
 * Construye el mensaje de escalación para el contacto de emergencia del
 * empleado. Este mensaje se envía cuando el admin no responde en 2 minutos.
 *
 * WorkSafeBC: el contacto de emergencia debe recibir información clara
 * sobre la situación, la última ubicación conocida, y la acción seleccionada
 * por el empleado. El mensaje debe ser multilingüe si el contacto tiene un
 * idioma registrado.
 *
 * @param employeeName - Nombre del empleado.
 * @param contact - Datos del contacto de emergencia.
 * @param lastGps - Última ubicación GPS conocida (lat, lng).
 * @param selectedAction - Acción seleccionada por el empleado.
 * @returns Mensaje listo para enviar por SMS/email al contacto.
 */
export function buildEscalationMessage(
  employeeName: string,
  contact: EmergencyContact,
  lastGps: { lat: number; lng: number } | null,
  selectedAction: EmergencyAction | null
): string {
  const mapUrl = lastGps
    ? `https://www.google.com/maps?q=${lastGps.lat},${lastGps.lng}`
    : "ubicación no disponible";

  const actionLabel = selectedAction
    ? EMERGENCY_ACTION_LABELS[selectedAction].emoji
    : "no especificada";

  return [
    `⚠️ EMERGENCIA — ${employeeName} activó el botón de seguridad.`,
    `Acción solicitada: ${actionLabel}`,
    `Última ubicación: ${mapUrl}`,
    `El empleador (admin) no respondió en ${ADMIN_RESPONSE_TIMER_MINUTES} minutos.`,
    `Contacto de emergencia: ${contact.nombre} (${contact.relacion})`,
    `Por favor, intente contactar a ${employeeName} de inmediato.`,
    `Si no logra contacto, llame al 911.`,
  ].join("\n");
}

/**
 * Determina la etapa actual del flujo de emergencia a partir de los timestamps.
 *
 * Esta es la máquina de estados del flujo post-abort. El orden de prioridad:
 * 1. Si el empleado ya seleccionó acción → "action_selected"
 * 2. Si las notificaciones fueron enviadas → "notifying_admin"
 * 3. Si el admin respondió → "admin_acknowledged"
 * 4. Si el timer expiró sin respuesta → "escalated_to_contact"
 * 5. Por defecto → "awaiting_action"
 *
 * @param state - Estado actual de la respuesta de emergencia.
 * @param nowIso - Timestamp actual (inyectado para testeabilidad).
 * @returns La etapa determinada.
 */
export function evaluateEmergencyStage(
  state: EmergencyResponseState,
  nowIso: string
): EmergencyResponseState["stage"] {
  // Escalado al contacto de emergencia: etapa terminal.
  if (state.escalated_at_iso) return "escalated_to_contact";

  // Admin respondió antes del timeout.
  if (state.admin_acknowledged_at_iso) return "admin_acknowledged";

  // Timeout de respuesta del admin → marcar como escalado.
  if (
    state.notifications.push_sent_at_iso &&
    hasAdminResponseTimedOut(state.sos_started_at_iso, nowIso, null)
  ) {
    return "escalated_to_contact";
  }

  // Notificaciones enviadas, timer corriendo.
  if (state.notifications.push_sent_at_iso) return "notifying_admin";

  // Empleado ya seleccionó acción.
  if (state.selected_action) return "action_selected";

  // Esperando que el empleado elija acción.
  return "awaiting_action";
}

/**
 * Construye el estado inicial de respuesta de emergencia a partir del ID
 * del Safety Abort y el timestamp de activación.
 *
 * @param safetyAbortId - ID del Safety Abort activo.
 * @param sosStartedAtIso - Timestamp de activación del SOS.
 * @returns Estado inicial del flujo de emergencia.
 */
export function createEmergencyResponseState(
  safetyAbortId: string,
  sosStartedAtIso: string
): EmergencyResponseState {
  return EmergencyResponseStateSchema.parse({
    safety_abort_id: safetyAbortId,
    sos_started_at_iso: sosStartedAtIso,
    stage: "awaiting_action",
    selected_action: null,
    last_gps: null,
    notifications: {
      push_sent_at_iso: null,
      sms_sent_at_iso: null,
      email_sent_at_iso: null,
    },
    admin_acknowledged_at_iso: null,
    escalated_at_iso: null,
  });
}

/**
 * Verifica que el contacto de emergencia del empleado sea válido antes de
 * intentar la escalación. Un contacto sin teléfono no puede recibir SMS
 * ni llamadas — la escalación quedaría incompleta.
 *
 * WorkSafeBC: el empleador es responsable de mantener contactos de
 * emergencia actualizados. Si el contacto es inválido, se debe registrar
 * como incidente de compliance.
 *
 * @param contact - El contacto de emergencia a validar.
 * @returns true si el contacto tiene al menos teléfono (mínimo para escalar).
 */
export function isEmergencyContactValid(contact: EmergencyContact): boolean {
  return EmergencyContactSchema.safeParse(contact).success && contact.telefono.length > 0;
}
