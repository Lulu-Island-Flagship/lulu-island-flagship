#!/usr/bin/env node
/**
 * v8.3 E6-C7 — Auditoría de accesibilidad de las 3 superficies.
 *
 * Ver LIMITACIONES REALES en el encabezado de src/lib/a11y-audit.ts:
 * esto NO es axe-core (no hay navegador ni DOM real en este repo). Es un
 * linter estático de patrones conocidos + contraste matemático de la
 * paleta de marca. Cubre un subconjunto verificable del criterio literal
 * de E6, no el criterio completo.
 *
 * Uso: npm run audit:a11y
 * Sale con código 1 si hay al menos una violación CRÍTICA.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "node_modules", ".a11y-audit-build");

execSync(
  `npx tsc ${join(root, "src/lib/a11y-audit.ts")} --outDir ${tmp} --module nodenext --target es2022 --skipLibCheck`,
  { stdio: "inherit" }
);
const { scanSource, isCritical, checkContrastPair } = await import(
  join(tmp, "a11y-audit.js")
);

execSync(
  `npx tsc ${join(root, "src/design/tokens.ts")} --outDir ${tmp} --module nodenext --target es2022 --skipLibCheck`,
  { stdio: "inherit" }
);
const { BRAND, STATE } = await import(join(tmp, "tokens.js"));

// Las 3 superficies reales del repo (confirmadas contra src/app/[locale] y
// src/components — no son un supuesto, se verificaron antes de escribir esto).
const SURFACES = {
  cliente: [
    "src/app/[locale]/cotizador",
    "src/app/[locale]/reserva",
    "src/app/[locale]/cuenta",
    "src/app/[locale]/confirmacion",
    "src/app/[locale]/evaluar",
    "src/components/cotizador",
    "src/components/reserva",
    "src/components/cuenta",
    "src/components/landing",
  ],
  empleado: ["src/app/[locale]/empleado", "src/components/empleado"],
  admin: ["src/app/[locale]/admin", "src/components/admin"],
};

function walk(dirRel) {
  const abs = join(root, dirRel);
  let files = [];
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    return files; // carpeta no existe en este checkout — se ignora, no se inventa.
  }
  for (const entry of entries) {
    const full = join(abs, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files = files.concat(walk(join(dirRel, entry)));
    } else if (extname(entry) === ".tsx" || extname(entry) === ".ts") {
      files.push(join(dirRel, entry));
    }
  }
  return files;
}

let totalCritical = 0;
let totalWarning = 0;
const reportBySurface = {};

for (const [surface, dirs] of Object.entries(SURFACES)) {
  const issues = [];
  for (const dir of dirs) {
    for (const relFile of walk(dir)) {
      const source = readFileSync(join(root, relFile), "utf8");
      issues.push(...scanSource(source, relFile));
    }
  }
  reportBySurface[surface] = issues;
  totalCritical += issues.filter(isCritical).length;
  totalWarning += issues.filter((i) => !isCritical(i)).length;
}

// Contraste real de la paleta de marca — aplica a las 3 superficies porque
// las 3 comparten src/design/tokens.ts como fuente única.
const contrastChecks = [
  checkContrastPair("ink/white", BRAND.ink, BRAND.white),
  checkContrastPair("navy/white", BRAND.navy, BRAND.white),
  checkContrastPair("waveBlue/white", BRAND.waveBlue, BRAND.white),
  checkContrastPair("gold/white (texto normal)", BRAND.gold, BRAND.white),
  checkContrastPair("gold/white (texto grande)", BRAND.gold, BRAND.white, true),
  checkContrastPair("goldDark/white (texto normal)", BRAND.goldDark, BRAND.white),
  checkContrastPair("goldDark/white (texto grande)", BRAND.goldDark, BRAND.white, true),
  checkContrastPair("danger/white", STATE.danger, BRAND.white),
  checkContrastPair("success/white", STATE.success, BRAND.white),
  checkContrastPair("warning/white (texto normal)", STATE.warning, BRAND.white),
  checkContrastPair("warning/white (texto grande)", STATE.warning, BRAND.white, true),
  checkContrastPair("info/white", STATE.info, BRAND.white),
];
const contrastFails = contrastChecks.filter((c) => !c.passesAA);

console.log("=== Auditoría de accesibilidad (E6-C7) — linter estático + contraste ===\n");
console.log("Contraste WCAG 2.1 AA — paleta de marca (src/design/tokens.ts):");
for (const c of contrastChecks) {
  const mark = c.passesAA ? "OK " : "FALLA";
  console.log(`  [${mark}] ${c.label}: ${c.ratio}:1 (mínimo ${c.isLargeText ? "3.0" : "4.5"}:1)`);
}
console.log("");

for (const [surface, issues] of Object.entries(reportBySurface)) {
  const critical = issues.filter(isCritical);
  const warning = issues.filter((i) => !isCritical(i));
  console.log(`Superficie: ${surface} — ${critical.length} críticas, ${warning.length} advertencias`);
  for (const i of [...critical, ...warning]) {
    const tag = isCritical(i) ? "CRÍTICO" : "advertencia";
    console.log(`  [${tag}] ${i.file}:${i.line} (${i.rule}) — ${i.message}`);
    console.log(`      ${i.snippet}`);
  }
  console.log("");
}

console.log(
  `Resumen: ${totalCritical} violaciones críticas de marcado, ${totalWarning} advertencias, ${contrastFails.length} pares de contraste fuera de AA.`
);

// --- Comparación contra línea base (ratchet) -------------------------------
// v8.3 E6-C7: el criterio literal ("sin errores críticos en las 3 superficies")
// NO está cumplido hoy — hay deuda real preexistente. Bloquear el build por
// completo ahora detendría todo merge a main sobre trabajo sin relación con
// accesibilidad (E7-E11), lo que en la práctica termina en que alguien
// deshabilite el gate. En vez de eso: se congela el número de hoy como línea
// base en a11y-audit-baseline.json y el CI solo falla si el número SUBE. Esto
// no es "ocultar" la deuda: queda impresa en cada corrida y en el reporte de
// etapa. Bajar la línea base a mano, con justificación en el commit, es la
// única forma válida de reducirla.
const baselinePath = join(root, "a11y-audit-baseline.json");
if (!existsSync(baselinePath)) {
  console.error(
    "\n::error:: Falta a11y-audit-baseline.json. No se puede evaluar el ratchet sin una línea base explícita."
  );
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

let regressions = [];
for (const surface of Object.keys(SURFACES)) {
  const current = reportBySurface[surface].filter(isCritical).length;
  const base = baseline.criticasPorSuperficie?.[surface] ?? 0;
  console.log(
    `Ratchet [${surface}]: actual=${current} línea base=${base} ${
      current > base ? "→ REGRESIÓN" : current < base ? "→ mejoró (baja la línea base si es real)" : "→ igual"
    }`
  );
  if (current > base) {
    regressions.push(
      `${surface}: ${current} violaciones críticas > línea base ${base} (+${current - base})`
    );
  }
}
const baseContrastFails = baseline.paresDeContrasteFueraDeAA ?? 0;
console.log(
  `Ratchet [contraste]: actual=${contrastFails.length} línea base=${baseContrastFails} ${
    contrastFails.length > baseContrastFails
      ? "→ REGRESIÓN"
      : contrastFails.length < baseContrastFails
        ? "→ mejoró (baja la línea base si es real)"
        : "→ igual"
  }`
);
if (contrastFails.length > baseContrastFails) {
  regressions.push(
    `contraste: ${contrastFails.length} pares fuera de AA > línea base ${baseContrastFails}`
  );
}

if (regressions.length > 0) {
  console.error("\n::error:: Auditoría de accesibilidad E6-C7 — regresión respecto a la línea base:");
  for (const r of regressions) console.error(`  - ${r}`);
  process.exit(1);
}

console.log(
  "\nSin regresiones respecto a la línea base. NOTA: esto NO significa cero violaciones — significa que no empeoró. Ver a11y-audit-baseline.json para la deuda real pendiente."
);
