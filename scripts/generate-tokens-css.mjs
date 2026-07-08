/**
 * v8.3 E0-C5 — Genera src/app/tokens.css desde src/design/tokens.ts.
 * Correr con: npm run tokens (también corre automáticamente en prebuild).
 * NO editar tokens.css a mano: se sobreescribe.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { register } from "node:module";

// Cargar el TS directamente (Node 22+ soporta strip-types vía import dinámico con tsx/tsc build).
// Para no depender de tsx aquí, extraemos las variables con un import dinámico del TS transpilado en memoria:
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "node_modules", ".tokens-build");

execSync(
  `npx tsc ${join(root, "src/design/tokens.ts")} --outDir ${tmp} --module nodenext --target es2022 --skipLibCheck`,
  { stdio: "inherit" }
);

const { cssVariables } = await import(join(tmp, "tokens.js"));

const vars = cssVariables();
const lines = Object.entries(vars)
  .map(([k, v]) => `  ${k}: ${v};`)
  .join("\n");

const css = `/* GENERADO desde src/design/tokens.ts — NO EDITAR A MANO (npm run tokens) */
/* v8.3 E0-C5: fuente única de tokens. Regla de dos lenguajes: esta paleta de
   marca nunca se mezcla con el código cromático de seguridad química (M11). */
:root {
${lines}
}
`;

writeFileSync(join(root, "src/app/tokens.css"), css);
console.log("OK: src/app/tokens.css generado desde src/design/tokens.ts");
