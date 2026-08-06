/**
 * @deprecated Use `@/lib/crypto.server` instead.
 *
 * This module was renamed to `crypto.server.ts` to clearly signal
 * that it is server-only (Node.js `crypto`).  Import from the new
 * path:
 *
 *   import { createHash } from "@/lib/crypto.server";
 */
export { createHash } from "./crypto.server";
