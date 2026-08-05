/**
 * v8.4 Capa 3 — Preference Domain Service.
 *
 * Servicio de dominio para consultar las preferencias de notificación de un
 * usuario (qué canales tiene habilitados por tipo de notificación, y cuál es
 * su canal preferido para un tipo específico).
 *
 * La tabla `user_notification_preferences` (migración futura) almacena una
 * fila por (user_id, notification_type, channel) con columnas `enabled`
 * (boolean) e `is_preferred` (boolean). Este servicio es el único punto de
 * acceso para leer esas preferencias desde cualquier módulo de comunicación
 * (Capa 3) o desde el centro de preferencias del usuario (UI de settings).
 *
 * Diseño: todas las funciones son async y requieren un SupabaseClient
 * (server-side). Nunca lanzan: si la consulta falla, devuelven valores por
 * defecto seguros (sin canales habilitados, sin preferido).
 */

import { captureError } from "@/lib/observability";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Devuelve qué canales están habilitados para cada notification_type.
 *
 * Retorna un Record donde cada clave es un notification_type (ej.
 * "order_confirmation", "payment_reminder", "marketing") y el valor es un
 * array de canales habilitados (ej. ["email", "sms"]).
 *
 * Si el usuario no tiene ninguna preferencia configurada, o si la consulta
 * falla, retorna un objeto vacío {} — el caller debe interpretar "sin
 * preferencias" como "usar defaults del sistema".
 */
export async function getUserPreferences(
  supabase: SupabaseClient,
  userId: string
): Promise<Record<string, string[]>> {
  try {
    const { data, error } = await supabase
      .from("user_notification_preferences")
      .select("notification_type, channel")
      .eq("user_id", userId)
      .eq("enabled", true);

    if (error) {
      captureError(error, {
        module: "preference-service.getUserPreferences",
        userId,
      });
      return {};
    }

    if (!data || data.length === 0) {
      return {};
    }

    // Agrupar canales por notification_type.
    const prefs: Record<string, string[]> = {};
    for (const row of data) {
      const type = row.notification_type as string;
      const channel = row.channel as string;
      if (!prefs[type]) {
        prefs[type] = [];
      }
      prefs[type].push(channel);
    }

    return prefs;
  } catch (err) {
    captureError(err, {
      module: "preference-service.getUserPreferences",
      userId,
    });
    return {};
  }
}

/**
 * Devuelve el canal preferido del usuario para un notification_type
 * específico, o null si no tiene preferencia configurada.
 *
 * La preferencia se determina por la fila con is_preferred=true para ese
 * (user_id, notification_type). Si hay más de una (dato corrupto), se
 * devuelve la primera que encuentre Supabase.
 *
 * Si el usuario no tiene ninguna preferencia para ese notification_type,
 * retorna null — el caller debe usar el default_channel del evento de
 * comunicación (communication_events.default_channel).
 */
export async function getPreferredChannel(
  supabase: SupabaseClient,
  userId: string,
  notificationType: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("user_notification_preferences")
      .select("channel")
      .eq("user_id", userId)
      .eq("notification_type", notificationType)
      .eq("is_preferred", true)
      .eq("enabled", true)
      .maybeSingle();

    if (error) {
      captureError(error, {
        module: "preference-service.getPreferredChannel",
        userId,
        notificationType,
      });
      return null;
    }

    return data?.channel ?? null;
  } catch (err) {
    captureError(err, {
      module: "preference-service.getPreferredChannel",
      userId,
      notificationType,
    });
    return null;
  }
}
