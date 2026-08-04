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

// ── v8.3 fix (auditoría 2026-08-03, A3): manifests PWA con hex hardcodeados ──
// Los manifests (public/manifest.json y public/manifest-empleado.json) tenían
// "#2E5C8A" hardcodeado como background_color/theme_color, violando la fuente
// única de tokens (E0-C5). Este bloque los regenera desde tokens.ts.
import { readFileSync } from "node:fs";
import { BRAND } from "../src/design/tokens.ts";

const MANIFEST_FILES = [
  { path: "public/manifest.json", bgColorKey: "navy", hint: "cliente" },
  { path: "public/manifest-empleado.json", bgColorKey: "navy", hint: "empleado" },
];

for (const mf of MANIFEST_FILES) {
  const manifestPath = join(root, mf.path);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.background_color = BRAND[mf.bgColorKey];
  manifest.theme_color = BRAND[mf.bgColorKey];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

console.log("OK: public/manifest.json y manifest-empleado.json sincronizados con tokens.ts");
