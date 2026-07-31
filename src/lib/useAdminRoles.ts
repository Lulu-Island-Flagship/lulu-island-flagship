"use client";

import { useEffect, useState } from "react";
import type { AdminRole } from "./admin-rbac";

/**
 * Fix (auditoría 2026-07-30, item 5): hook cliente mínimo para que páginas
 * owner-only (seguridad, feature-flags, y similares) puedan verificar el rol
 * real del usuario ANTES de disparar su propio fetch a una API protegida --
 * en vez de mostrar loaders y luego un 403 crudo si un no-owner entra.
 *
 * Consume /api/admin/my-roles (solo devuelve los roles del propio usuario
 * autenticado). `loading` queda en true hasta la primera respuesta; en caso
 * de error de red se resuelve como roles=[] (fail-closed: sin roles
 * confirmados, no se asume acceso).
 */
export function useAdminRoles(): { roles: AdminRole[]; loading: boolean } {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/my-roles", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { roles: [] }))
      .then((data) => {
        if (cancelled) return;
        setRoles(Array.isArray(data.roles) ? data.roles : []);
      })
      .catch(() => {
        if (!cancelled) setRoles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { roles, loading };
}
