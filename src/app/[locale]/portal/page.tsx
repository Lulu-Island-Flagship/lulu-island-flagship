"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { isAllowedInternalPath } from "@/lib/safe-redirect";
import { Loader2 } from "lucide-react";
import StaffLoginScreen from "@/components/portal/StaffLoginScreen";

type Phase = "checking" | "resolving" | "login" | "rejected";

/**
 * v8.3 — /portal: entrada única del "Portal de equipo" (empleado,
 * ops_coordinator, qc_only, owner_admin). Ver src/lib/staff-login.ts para la
 * lógica de autorización real (vive en el servidor, en
 * /api/staff/resolve-login) -- esta página solo orquesta el flujo visual:
 * sin sesión -> StaffLoginScreen; con sesión -> pedir el veredicto al
 * servidor y redirigir, o mostrar el rechazo (nunca crea nada por su cuenta).
 */
export default function PortalPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-navy" />
        </main>
      }
    >
      <PortalContent />
    </Suspense>
  );
}

function PortalContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations("portal.page");
  const locale = (params?.locale as string) || "en";

  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const authError = searchParams.get("auth_error");
      if (authError) {
        // Fix (auditoría externa, hallazgo confirmado): antes CUALQUIER
        // valor de auth_error (provider_error, missing_code,
        // session_exchange_failed -- ver src/app/auth/callback/route.ts)
        // caía en el mismo mensaje genérico "Couldn't sign you in", sin
        // distinguir "Google rechazó la solicitud" de "no se pudo
        // intercambiar la sesión con el servidor". Cada código ya existía
        // en el callback; solo faltaba mapearlo a un mensaje específico acá.
        if (!cancelled) {
          const specificKey =
            authError === "provider_error"
              ? "errors.providerError"
              : authError === "missing_code"
                ? "errors.missingCode"
                : authError === "session_exchange_failed"
                  ? "errors.sessionExchangeFailed"
                  : "errors.authFailed";
          setMessage(t(specificKey));
          setPhase("login");
        }
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setPhase("login");
        return;
      }

      if (!cancelled) setPhase("resolving");
      try {
        const res = await fetch("/api/staff/resolve-login", {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          // Fix (auditoría de autenticación 2026-07-25/26, item 2 + auditoría
          // externa siguiente, hallazgo confirmado): antes se pintaba
          // data.error del servidor directamente -- ese texto vive en
          // src/lib/staff-login.ts (STAFF_UNAUTHORIZED_MESSAGE /
          // STAFF_PENDING_ACTIVATION_MESSAGE) quemado en español, así que un
          // cliente en /fr o /zh lo veía igual, en español. El servidor ahora
          // manda `reason` (código estable: no_session, server_config_error,
          // not_registered, pending_activation) además de `error`; se prefiere
          // el mensaje localizado por reason, y `error`/notAuthorized quedan
          // solo como último recurso si el servidor no manda un reason
          // reconocido.
          const reasonKey =
            data.reason === "not_registered"
              ? "errors.notRegistered"
              : data.reason === "pending_activation"
                ? "errors.pendingActivation"
                : data.reason === "no_session"
                  ? "errors.noSession"
                  : data.reason === "server_config_error"
                    ? "errors.serverConfigError"
                    : null;
          setMessage(reasonKey ? t(reasonKey) : data.error || t("errors.notAuthorized"));
          setPhase("rejected");
          return;
        }

        // v8.3 fix M-1 (auditoría implacable 2026-07-20b): antes se
        // ignoraba por completo el ?next= original (el que admin/layout.tsx
        // o empleado/page.tsx ponen al mandar aquí, ej.
        // next=/en/admin/nomina) y siempre se redirigía al landing fijo del
        // área (data.path, ver AREA_TO_PATH en
        // src/app/api/staff/resolve-login/route.ts) -- un ops_coordinator
        // que quería volver a /admin/nomina terminaba en /admin sin más.
        //
        // `next` es input controlado por quien arma la URL (query param) --
        // mismo riesgo de open redirect que ya se blindó en
        // src/app/auth/callback/route.ts: solo se acepta una ruta relativa
        // que empiece con "/" y no con "//". Además, y esto es lo que
        // faltaba en el fix ingenuo, `next` solo se honra si su prefijo de
        // área coincide con el área real que el servidor acaba de resolver
        // (data.path) -- si no coincide (ej. un qc_only con
        // next=/en/admin/nomina, cuyo prefijo de área es /admin pero
        // data.path es /admin/qc), se ignora `next` y se cae al landing fijo
        // del área real. Así un qc_only nunca puede usar `next` para llegar
        // a una página de /admin fuera de /admin/qc.
        // Fix (auditoría de autenticación 2026-07-25/26, item 6):
        // isAllowedInternalPath (src/lib/safe-redirect.ts) agrega, además del
        // chequeo de "/" y no "//", una allowlist de secciones internas
        // conocidas -- defensa adicional antes incluso de la comparación de
        // área de abajo.
        const rawNext = searchParams.get("next");
        const safeNext = isAllowedInternalPath(rawNext) ? rawNext : null;
        // safeNext ya viene con el locale incluido (ej. /en/admin/nomina) --
        // el prefijo de área real es todo lo que sigue al segmento de
        // locale, así que se compara ese resto contra data.path
        // ("/admin", "/admin/qc" o "/empleado").
        const nextAreaPath = safeNext
          ? "/" + safeNext.split("/").filter(Boolean).slice(1).join("/")
          : null;
        // Fix (auditoría 2026-07-31, hallazgo confirmado): `nextAreaPath.
        // startsWith(data.path)` compara STRINGS, no segmentos de ruta -- para
        // data.path = "/admin/qc" (área qc_only), un nextAreaPath hipotético
        // como "/admin/qcxyz" también pasaría el startsWith (comparten el
        // prefijo de caracteres "/admin/qc") aunque no sea en absoluto una
        // subruta real de /admin/qc. Hoy no existe ninguna ruta bajo
        // src/app/[locale]/admin/ que empiece con "qc" salvo la carpeta
        // qc/ misma, así que no es explotable con las rutas actuales -- pero
        // es una comparación frágil que se rompe en cuanto alguien agregue
        // una sección nueva con ese prefijo (ej. /admin/qc-legacy). Se
        // compara por SEGMENTOS: coincide si es exactamente igual o si el
        // siguiente carácter tras el prefijo es "/" (límite de segmento
        // real), nunca un prefijo de string suelto.
        const isSameArea = nextAreaPath
          ? nextAreaPath === data.path || nextAreaPath.startsWith(`${data.path}/`)
          : false;

        router.replace(isSameArea && safeNext ? safeNext : `/${locale}${data.path}`);
      } catch {
        if (!cancelled) {
          setMessage(t("errors.connection"));
          setPhase("rejected");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // v8.3 fix M-4: antes las deps eran [] -- si el usuario volvía a
    // /portal con un ?auth_error= distinto (ej. reintenta el login y falla
    // de nuevo) el efecto no se re-evaluaba porque React nunca lo veía como
    // "cambiado". searchParams sí cambia de referencia cuando cambia la
    // query string, así que agregarlo como dep hace que un nuevo
    // auth_error se procese sin necesitar un full reload. router/locale no
    // se agregan: son estables entre renders de esta página y agregarlos no
    // cambia el comportamiento, solo ruido en el array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (phase === "checking" || phase === "resolving") {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-brand-navy mx-auto" />
          <p className="text-sm text-gray-500">{t("checkingAccount")}</p>
        </div>
      </main>
    );
  }

  if (phase === "rejected") {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-elevation-1 p-8 max-w-sm w-full text-center space-y-4">
          <h1 className="text-xl font-bold text-brand-ink">{t("title")}</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-state-danger">
            {message}
          </div>
          <button
            onClick={() => {
              setMessage("");
              setPhase("login");
            }}
            className="text-sm text-brand-wave-blue hover:underline"
          >
            {t("tryAgain")}
          </button>
        </div>
      </main>
    );
  }

  return <StaffLoginScreen locale={locale} error={message} />;
}
