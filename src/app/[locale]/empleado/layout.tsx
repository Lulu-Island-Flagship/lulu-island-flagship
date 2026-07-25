import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ServiceWorkerRegister } from "@/components/empleado/ServiceWorkerRegister";
import { SafetyAbortButton } from "@/components/empleado/SafetyAbortButton";
import { getServiceRoleClient, getSupabaseClient } from "@/lib/admin";
import { resolveStaffLogin } from "@/lib/staff-login";

// v8.3 E7 (D.10 #7): el botón de aborto seguro (SOS) se monta aquí para
// estar disponible en TODA página del área de empleado, no solo la de un
// servicio activo -- antes, safety-abort/route.ts existía pero ningún
// componente lo invocaba, el SOS era inalcanzable en la práctica.
//
// v8.3 fix G-2 (auditoría implacable 2026-07-20b): antes este layout no
// tenía NINGUNA guarda de sesión -- solo montaba ServiceWorkerRegister y
// SafetyAbortButton alrededor de {children}. De las 14 subpáginas de
// /empleado, solo page.tsx (el dashboard) y enfermedad/page.tsx tenían su
// propio chequeo de auth del lado del cliente; las otras 12 (ritual,
// checkin, score, descansos, votacion, marketing, panos, seguridad,
// chat/[orderId], llaves/[orderId], servicio/[orderId] y su preparacion)
// eran alcanzables sin sesión alguna, con solo saber la URL.
//
// Este layout ahora es un Server Component async que reutiliza
// resolveStaffLogin() (src/lib/staff-login.ts) -- la MISMA función que ya
// usa /api/staff/resolve-login para /portal y para el dashboard de
// empleado -- en vez de reimplementar la lógica de autorización. No se
// llama al endpoint HTTP (no tiene sentido un round-trip a sí mismo);
// se invoca la función pura directamente con un cliente service-role,
// igual que hace la Route Handler.
//
// Importante (no reintroducir G-2): una cuenta admin/qc que visita
// /empleado por error está AUTORIZADA (resolveStaffLogin la reconoce),
// solo que su área no es "empleado" -- este layout NUNCA llama a
// supabase.auth.signOut() por su cuenta. Simplemente redirige a /portal,
// que vuelve a resolver el destino real (y es el único lugar, vía
// /api/staff/resolve-login, donde una cuenta VERDADERAMENTE no autorizada
// -- not_registered / pending_activation -- termina cerrando sesión).
export default async function EmpleadoLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const headersList = headers();
  const pathname = headersList.get("x-invoke-path") || headersList.get("x-pathname") || `/${params.locale}/empleado`;
  const localeFromHeader = pathname.split("/")[1] || params.locale || "en";
  const safeLocale = ["en", "zh", "fr"].includes(localeFromHeader) ? localeFromHeader : "en";
  // Fix 2026-07-24 (auditoría externa, M-1 parcial): antes se mandaba
  // siempre next=/${safeLocale}/empleado (el área genérica), descartando la
  // subruta real (ej. /empleado/ritual) aunque `pathname` ya la tuviera --
  // portal/page.tsx honra next= desde el fix M-1 original, pero solo si
  // quien redirige se lo pasa. Ahora se preserva la subruta real.
  const safePathname = pathname && pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : `/${safeLocale}/empleado`;
  const portalUrl = `/${safeLocale}/portal?next=${encodeURIComponent(safePathname)}`;

  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(portalUrl);
  }

  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    // Configuración de servidor incompleta (falta SUPABASE_SERVICE_ROLE_KEY)
    // -- fail-safe: mandar al Portal en vez de dejar pasar sin verificar.
    redirect(portalUrl);
  }

  const result = await resolveStaffLogin(serviceClient, user.id, user.email);

  if (!result.authorized || result.area !== "empleado") {
    // Cubre tanto "wrong_area" (cuenta admin/qc válida, sin signOut) como
    // "rejected" (not_registered / pending_activation) -- en este último
    // caso, /portal vuelve a llamar a /api/staff/resolve-login, que SÍ
    // ejecuta el signOut() server-side antes de responder 403 (ver
    // src/app/api/staff/resolve-login/route.ts). Este layout nunca lo hace
    // directamente.
    redirect(portalUrl);
  }

  return (
    <>
      <ServiceWorkerRegister />
      {children}
      <SafetyAbortButton />
    </>
  );
}
