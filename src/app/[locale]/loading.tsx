// Fix (auditoría transversal 2026-07-25, item 6): no existía ningún
// loading.tsx bajo src/app/[locale]/ -- Next.js no mostraba ningún
// indicador de carga durante la navegación/streaming entre rutas del
// locale (pantalla en blanco hasta que el Server Component resuelve).
// Server Component simple (sin hooks, sin next-intl) a propósito: correr
// texto traducido aquí requeriría await getTranslations() en cada
// suspense-boundary trigger, y un spinner puramente visual no necesita
// texto para ser útil -- aria-label alcanza para lectores de pantalla sin
// depender de que los mensajes ya hayan cargado.
export default function Loading() {
  return (
    <div
      className="min-h-screen bg-white flex items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <div className="w-10 h-10 rounded-full border-4 border-brand-ice border-t-brand-navy animate-spin" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
