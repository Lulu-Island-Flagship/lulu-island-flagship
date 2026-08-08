// ─── Barrel de administración ─────────────────────────────────────────
//
// Re-exporta los módulos especializados para mantener compatibilidad hacia
// atrás con todos los import existentes desde "@lib/admin".
//
// Módulos fuente:
//   src/lib/supabase-client.ts  → getSupabaseClient, getServiceRoleClient
//   src/lib/admin-guards.ts     → requireAdminRole, requireSupervisor, logAdminAction
//   src/lib/admin-roles.ts      → getCurrentAdminRoles
//   src/lib/admin-rbac.ts       → tipos de rol/recurso, matriz y helpers

export { getSupabaseClient, getServiceRoleClient } from "./supabase-client";
export { requireSupervisor, requireAdminRole, logAdminAction } from "./admin-guards";
export type { LogAdminActionParams } from "./admin-guards";
export { getCurrentAdminRoles } from "./admin-roles";
export { roleAllows, matchingRole, allowedResources } from "./admin-rbac";
export type { AdminRole, AdminResource } from "./admin-rbac";
