import { redirect } from "next/navigation";

// 2026-07-23: Consolidación de páginas duplicadas de continuidad de negocio.
// Esta página y /admin/dr-drill eran dos implementaciones separadas de la misma
// función (ambas consumían /api/admin/dr-drill), una enlazada solo desde
// AdminNav.tsx (esta) y otra solo desde el dashboard (/admin/dr-drill). La de
// /admin/dr-drill tenía más funcionalidad real -- bitácora manual para los
// simulacros no automatizables (succession_simulation, emergency_kit_check,
// fallback_no_admin) y seguimiento de vencimiento por tipo -- que esta página no
// tenía. Se consolidó todo en /admin/dr-drill (incluyendo el badge
// "confirmed / declared in plan" que era exclusivo de esta página) y esta ruta
// ahora solo redirige, para no romper bookmarks o links externos existentes.
// AdminNav.tsx fue actualizado para apuntar directamente a /admin/dr-drill.
export default function RecuperacionDesastresRedirectPage({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/admin/dr-drill`);
}
