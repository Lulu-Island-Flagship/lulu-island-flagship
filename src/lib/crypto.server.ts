/**
 * Crypto helper — server-only (Node.js crypto).
 *
 * ⚠️  This module uses Node.js `crypto` and MUST NOT be imported
 * from Client Components.  The `.server.ts` suffix and the runtime
 * guard below ensure it only runs in server contexts (API routes,
 * Server Components, server-side libraries).
 *
 * Uso: reemplaza `import { createHash } from "node:crypto"` por
 * `import { createHash } from "@/lib/crypto.server"`.
 */

import { createHash as nodeCreateHash } from "node:crypto";

/** API idéntica a createHash("sha256") de node:crypto. */
export function createHash(algorithm: string) {
  return nodeCreateHash(algorithm);
}
