import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

/**
 * v8.3 Sesión P — Guardrail de cobertura RBAC.
 *
 * Auditoría del 2026-07-10 encontró rutas bajo src/app/api/admin/** que no
 * llamaban a requireAdminRole (ver src/lib/admin.ts) pese a comentarios que
 * decían "solo supervisor" / "solo owner" — una exposición de seguridad real,
 * no solo un hueco de alcance.
 *
 * Este test recorre el árbol de archivos de src/app/api/admin/ y falla si
 * encuentra un route.ts que exporte un handler HTTP (GET/POST/PUT/PATCH/
 * DELETE) sin ninguna referencia textual a "requireAdminRole" o
 * "getCurrentAdminRoles" en el archivo. Es una comprobación estática y
 * deliberadamente simple: no evalúa lógica, solo la presencia de la llamada
 * al guard. Objeto es que este problema no pueda volver a colarse en
 * silencio en un PR futuro.
 *
 * getCurrentAdminRoles() (ver src/lib/admin.ts) se acepta como guard
 * alternativo válido desde la auditoría 2026-07-30: es un segundo patrón
 * legítimo (no un bypass) para endpoints intencionalmente de "cualquier rol
 * admin autenticado" (ej. my-roles, operating-mode) en vez de un recurso
 * RBAC específico -- hace su propio supabase.auth.getUser() + lee
 * admin_roles reales, solo que no lo compara contra la matriz de recursos
 * de requireAdminRole. Sigue siendo verificación real de sesión + rol, no
 * texto decorativo.
 */

const ADMIN_API_ROOT = path.join(__dirname, "..", "..", "src", "app", "api", "admin");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function findRouteFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findRouteFiles(full));
    } else if (entry.isFile() && entry.name === "route.ts") {
      files.push(full);
    }
  }
  return files;
}

function exportedHttpMethods(source: string): string[] {
  const found: string[] = [];
  for (const method of HTTP_METHODS) {
    // Cubre "export async function GET(" / "export function GET(" y
    // "export const GET = ..." (por si en el futuro se usa esa forma).
    const re = new RegExp(
      `export\\s+(async\\s+function\\s+${method}\\s*\\(|function\\s+${method}\\s*\\(|const\\s+${method}\\s*=)`
    );
    if (re.test(source)) found.push(method);
  }
  return found;
}

describe("RBAC coverage guardrail: src/app/api/admin/**", () => {
  it("el directorio de rutas admin existe", () => {
    assert.ok(fs.existsSync(ADMIN_API_ROOT), `No existe ${ADMIN_API_ROOT}`);
  });

  const routeFiles = fs.existsSync(ADMIN_API_ROOT) ? findRouteFiles(ADMIN_API_ROOT) : [];

  it("encontró al menos una ruta admin (sanity check del propio test)", () => {
    assert.ok(
      routeFiles.length > 10,
      `Se esperaban >10 route.ts bajo src/app/api/admin, se encontraron ${routeFiles.length}. ` +
        `Si el árbol de carpetas cambió de forma legítima, revisa ADMIN_API_ROOT en este test.`
    );
  });

  it("toda ruta admin que exporta un handler HTTP referencia requireAdminRole o getCurrentAdminRoles", () => {
    const offenders: string[] = [];

    for (const file of routeFiles) {
      const source = fs.readFileSync(file, "utf-8");
      const handlers = exportedHttpMethods(source);
      if (handlers.length === 0) continue; // archivo helper sin handler exportado, no aplica

      if (!source.includes("requireAdminRole") && !source.includes("getCurrentAdminRoles")) {
        const relative = path.relative(path.join(__dirname, "..", ".."), file);
        offenders.push(`${relative} (handlers: ${handlers.join(", ")})`);
      }
    }

    assert.deepStrictEqual(
      offenders,
      [],
      `Rutas admin sin requireAdminRole/getCurrentAdminRoles encontradas:\n${offenders.join("\n")}`
    );
  });
});
