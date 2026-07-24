import React from "react";

/**
 * Skeleton loaders genéricos -- reemplazan spinners/"Loading..." centrados
 * en páginas de alto tráfico para aproximar la forma real del contenido
 * mientras carga (mejora percepción de velocidad, reduce salto de layout).
 * Todos usan `animate-pulse` de Tailwind sobre bloques grises.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

/** Tarjeta fantasma para grids de métricas (ej. DashboardMetricsPanel). */
export function SkeletonMetricCard() {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-2.5 w-2.5 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-8 w-16" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

/** Grid de N tarjetas de métricas fantasma. */
export function SkeletonMetricsGrid({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonMetricCard key={i} />
      ))}
    </div>
  );
}

/** Tarjeta fantasma para una fila de servicio/orden (cuenta e historial). */
export function SkeletonServiceCard() {
  return (
    <div className="bg-white rounded-xl border overflow-hidden p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-4 w-20 shrink-0" />
      </div>
    </div>
  );
}

/** Lista de N tarjetas de servicio fantasma. */
export function SkeletonServiceList({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonServiceCard key={i} />
      ))}
    </div>
  );
}
