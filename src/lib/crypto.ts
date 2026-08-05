/**
 * Crypto helper — compatible con Next.js (servidor + cliente).
 *
 * Webpack en Next.js no puede manejar "node:crypto" en el bundle del cliente.
 * Para evitar el error "Reading from node:crypto is not handled by plugins",
 * envolvemos la importación de node:crypto en require() dinámico.
 *
 * En el servidor: require("node:crypto").createHash(algorithm)
 * En el cliente: no debería llamarse nunca (las funciones criptográficas
 *   son solo para server components / API routes / server-side libs).
 *
 * Uso: reemplaza `import { createHash } from "node:crypto"` por
 * `import { createHash } from "@/lib/crypto"`.
 */

/** API idéntica a createHash("sha256") de node:crypto. */
export function createHash(algorithm: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("node:crypto").createHash(algorithm);
}
