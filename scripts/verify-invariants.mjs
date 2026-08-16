#!/usr/bin/env node
/**
 * verify-invariants.mjs — Manifiesto de Gobernanza de Desarrollo v5.0
 *
 * Empaqueta los checks grep de invariantes que antes vivían inline en
 * .github/workflows/ci.yml en un comando local: `npm run verify:invariants`.
 *
 * Node ESM, sin dependencias, Node >= 20. Implementado con `fs` (sin shell)
 * para que los patrones con corchetes (`src/app/[locale]/`) y comillas no
 * dependan del escaping del shell. Sale con código 1 + mensaje claro si
 * alguna de las invariantes falla.
 *
 * Invariantes:
 *   1. Tokens de diseño — cero hex de marca fuera de la fuente única
 *      (src/design/tokens.ts y src/app/tokens.css).
 *   2. Contraste — `text-brand-gold` (dorado claro, 2.25:1) nunca como
 *      texto/icono; debe usarse `text-brand-gold-dark`.
 *   3. Privacidad — sin `select("*")` sobre quotes/orders en páginas de
 *      cliente (src/app/[locale]/).
 *   4. (v5.0) Waivers: expiración (expires_at en el futuro), máximo 5
 *      activos, antigüedad ≤ 30 días y approver como commit firmado (40 hex).
 *   5. (v5.0) UNCLASSIFIED: cada archivo del diff debe clasificar en un
 *      bounded context de .governance/bounded-contexts.yaml; si no, el gate
 *      bloquea (núcleo, Parte 2.4). Imprime la cota superior de riesgo.
 *   6. (v5.0) Evidencia mínima: en .governance/rules.yaml, toda regla con
 *      una dimensión CRITICAL debe declarar evidence_level ≥ E3 (Parte 3.2).
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

// Raíz del repo, derivada de la ubicación del propio script (robusto aunque
// se invoque desde otro cwd).
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Lista recursiva de archivos bajo `dir` filtrados por extensión (o todos si `exts` es null). */
function walk(dir, exts = null) {
  const abs = join(REPO_ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(rel, exts));
    } else if (entry.isFile()) {
      if (!exts || exts.some((e) => entry.name.endsWith(e))) out.push(rel);
    }
  }
  return out;
}

/** Lee un archivo como texto UTF-8; devuelve null si no existe o no es texto. */
function readText(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

/** Número de línea (1-based) de una posición dentro de un texto. */
function lineNumberOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

// ---------------------------------------------------------------------------
// Invariante 1 — Tokens de diseño: cero hex de marca fuera de la fuente única
// (equivalente a: grep -rln -iE "#2E5C8A|#3E6D9E|#3A6E9E|#E3AAB8|#8A3A46|#1F2E3D"
//  src/ tailwind.config.ts --include="*.ts" --include="*.tsx" --include="*.css")
// ---------------------------------------------------------------------------
const BRAND_HEX = ["#2e5c8a", "#3e6d9e", "#3a6e9e", "#e3aab8", "#8a3a46", "#1f2e3d"];
const HEX_ALLOWED = new Set(["src/design/tokens.ts", "src/app/tokens.css"]);

function checkTokens() {
  const files = [
    ...walk("src", [".ts", ".tsx", ".css"]),
    ...(existsSync(join(REPO_ROOT, "tailwind.config.ts")) ? ["tailwind.config.ts"] : []),
  ];
  const violations = [];
  for (const file of files) {
    if (HEX_ALLOWED.has(file)) continue;
    const content = readText(file);
    if (content === null) continue;
    const lower = content.toLowerCase();
    for (const hex of BRAND_HEX) {
      const idx = lower.indexOf(hex);
      if (idx !== -1) {
        violations.push(`${file}:${lineNumberOf(content, idx)} (${hex.toUpperCase()})`);
        break; // un archivo = una violación (grep -l reporta el archivo una vez)
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Invariante 2 — Contraste: text-brand-gold claro nunca como texto/icono
// (equivalente a: grep -rnE 'text-brand-gold([^-]|$)' src/
//  --include="*.tsx" --include="*.ts")
// ---------------------------------------------------------------------------
const GOLD_TEXT_RE = /text-brand-gold([^-]|$)/;

function checkContrast() {
  const files = walk("src", [".ts", ".tsx"]);
  const violations = [];
  for (const file of files) {
    if (file === "src/design/tokens.ts") continue; // fuente única permitida
    const content = readText(file);
    if (content === null) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (GOLD_TEXT_RE.test(lines[i])) {
        violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Invariante 3 — Privacidad: sin select("*") sobre quotes/orders en páginas
// de cliente (equivalente a: grep -rn 'from("quotes")' src/app/[locale]/ -A2
// y grep -rn 'from("orders")' src/app/[locale]/ -A2, fallando si el contexto
// contiene select("*"))
// ---------------------------------------------------------------------------
const PRIVACY_TABLES = ['from("quotes")', 'from("orders")'];

function checkPrivacy() {
  const dir = "src/app/[locale]";
  const files = walk(dir);
  const violations = [];
  if (!existsSync(join(REPO_ROOT, dir))) {
    return { violations, note: `directorio ${dir} no existe — nada que verificar` };
  }
  for (const file of files) {
    const content = readText(file);
    if (content === null) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const table = PRIVACY_TABLES.find((t) => lines[i].includes(t));
      if (!table) continue;
      // grep -A2: línea del match + 2 siguientes.
      for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) {
        if (lines[j].includes('select("*")')) {
          violations.push(
            `${file}:${i + 1} ${table.trim()} → ${file}:${j + 1}: ${lines[j].trim()}`
          );
        }
      }
    }
  }
  return { violations };
}

// ---------------------------------------------------------------------------
// Invariante 4 (v5.0) — Waivers vencidos
// Escanea .governance/waivers/*.yaml (ignora *.example.yaml, *.template.yaml
// y archivos sin clave `waiver:`). Falla si waiver.expires_at (YYYY-MM-DD)
// ya venció.
// ---------------------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de hoy en la zona local del runner (YYYY-MM-DD). */
function todayLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function checkWaivers() {
  const dir = ".governance/waivers";
  const abs = join(REPO_ROOT, dir);
  if (!existsSync(abs)) {
    return { scanned: [], violations: [], today: todayLocal(), note: `directorio ${dir} no existe — sin waivers` };
  }

  const today = todayLocal();
  const scanned = [];
  const violations = [];

  for (const name of readdirSync(abs, { withFileTypes: true })) {
    if (!name.isFile() || !name.name.endsWith(".yaml")) continue;
    if (name.name.endsWith(".example.yaml") || name.name.endsWith(".template.yaml")) continue;

    const content = readText(join(dir, name.name));
    if (content === null) continue;

    const lines = content.split("\n");
    const waiverLine = lines.findIndex((l) => /^\s*waiver\s*:/.test(l));
    if (waiverLine === -1) continue; // sin clave `waiver:` → se ignora

    const rel = `${dir}/${name.name}`;
    scanned.push(rel);

    // Bloque del waiver: líneas siguientes con indentación mayor a la de `waiver:`.
    const blockStart = lines[waiverLine].search(/\S/);
    let expiresAt = null;
    let approver = null;
    for (let i = waiverLine + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      const indent = line.search(/\S/);
      if (indent <= blockStart) break; // fin del bloque (otra clave top-level)
      const mExp = line.match(/^\s*expires_at\s*:\s*(.*)$/);
      if (mExp && expiresAt === null) {
        expiresAt = mExp[1].replace(/["']/g, "").split(/\s+#/)[0].trim();
      }
      const mApp = line.match(/^\s*approver\s*:\s*(.*)$/);
      if (mApp && approver === null) {
        approver = mApp[1].replace(/["']/g, "").split(/\s+#/)[0].trim();
      }
    }

    if (!expiresAt || !DATE_RE.test(expiresAt)) {
      violations.push(
        `${rel}: waiver activo sin \`waiver.expires_at\` válido (YYYY-MM-DD) — valor encontrado: ${JSON.stringify(expiresAt)}`
      );
    } else if (expiresAt < today) {
      const daysOverdue = Math.round(
        (new Date(today + "T00:00:00Z").getTime() - new Date(expiresAt + "T00:00:00Z").getTime()) / 86400000
      );
      violations.push(`${rel}: waiver vencido — expires_at ${expiresAt} < hoy (${today}), ${daysOverdue} día(s) vencido(s)`);
    }

    // Antigüedad máxima sin resolver (núcleo Parte 5.2): 30 días.
    const nameMatch = name.name.match(/_(\d{4}-\d{2}-\d{2})\.yaml$/);
    let createdAt = null;
    if (nameMatch) {
      createdAt = nameMatch[1];
    } else {
      try {
        const mtime = statSync(join(abs, name.name)).mtime;
        createdAt = `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, "0")}-${String(mtime.getDate()).padStart(2, "0")}`;
      } catch {
        createdAt = null;
      }
    }
    if (createdAt && DATE_RE.test(createdAt)) {
      const ageDays = Math.round(
        (new Date(today + "T00:00:00Z").getTime() - new Date(createdAt + "T00:00:00Z").getTime()) / 86400000
      );
      if (ageDays > 30) {
        violations.push(`${rel}: waiver con ${ageDays} días de antigüedad (> 30, núcleo Parte 5.2) — resuélvelo o renuévalo`);
      }
    }

    // Aprobación humana documentada = commit firmado (núcleo Parte 5.3): 40 hex.
    if (!/^[0-9a-f]{40}$/.test(approver || "")) {
      violations.push(
        `${rel}: \`waiver.approver\` debe ser un commit firmado (SHA de 40 hex, Parte 5.3) — valor: ${JSON.stringify(approver)}`
      );
    }
  }

  // Máximo de waivers activos (núcleo Parte 5.2): 5.
  if (scanned.length > 5) {
    violations.push(`Hay ${scanned.length} waivers activos (> 5, núcleo Parte 5.2)`);
  }

  return { scanned, violations, today };
}

// ---------------------------------------------------------------------------
// Gate v5.0 — Bounded contexts: rutas UNCLASSIFIED bloquean (núcleo 2.4/3.4)
// ---------------------------------------------------------------------------
const SEVERITY_ORDER = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const EVIDENCE_ORDER = ["E0", "E1", "E2", "E3", "E4", "E5"];
const CRITICAL_DIMS = ["integrity", "financial_exposure", "privacy", "reversibility", "availability", "regulatory"];

function loadYaml(rel) {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) throw new Error(`Falta ${rel}`);
  return yaml.load(readFileSync(p, "utf8"));
}

function patternToRegex(p) {
  let s = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  s = s.replace(/\*\*|\*/g, (m) => (m === "**" ? ".*" : "[^/]*"));
  return new RegExp("^" + s + "$");
}

function gitChangedFiles() {
  const run = (args) => {
    try {
      return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const base = run("merge-base HEAD origin/main") || run("merge-base HEAD main") || null;
  const changed = new Set();
  if (base) {
    const diff = run(`diff --name-only --diff-filter=ACMRT ${base}...HEAD`) || "";
    diff.split("\n").filter(Boolean).forEach((f) => changed.add(f));
  }
  // Cambios locales sin commit (tracked, staged o no) + untracked.
  (run("diff --name-only") || "")
    .split("\n")
    .filter(Boolean)
    .forEach((f) => changed.add(f));
  (run("diff --name-only --cached") || "")
    .split("\n")
    .filter(Boolean)
    .forEach((f) => changed.add(f));
  (run("ls-files --others --exclude-standard") || "")
    .split("\n")
    .filter(Boolean)
    .forEach((f) => changed.add(f));
  return { base, files: [...changed].filter((f) => !/^(node_modules|\.next|\.git)(\/|$)/.test(f)) };
}

function checkUnclassified() {
  let map;
  try {
    map = loadYaml(".governance/bounded-contexts.yaml");
  } catch (err) {
    return { violations: [`No se pudo cargar .governance/bounded-contexts.yaml: ${err.message}`], note: null };
  }
  const contexts = map.bounded_contexts || {};
  const compiled = Object.fromEntries(
    Object.entries(contexts).map(([ctx, def]) => [ctx, (def.paths || []).map(patternToRegex)])
  );
  const { base, files } = gitChangedFiles();
  if (!base) {
    return { violations: [], note: "gate UNCLASSIFIED omitido: no hay base git (origin/main ni main) para calcular el diff" };
  }
  const touched = new Set();
  const unclassified = [];
  for (const f of files) {
    const entry = Object.entries(compiled).find(([, res]) => res.some((r) => r.test(f)));
    if (entry) touched.add(entry[0]);
    else unclassified.push(f);
  }
  // Cota superior de riesgo (informativo, núcleo Parte 3.4).
  const risk = map.context_risk || {};
  const cota = {};
  for (const ctx of touched) {
    for (const [dim, level] of Object.entries(risk[ctx] || {})) {
      const prev = cota[dim] ? SEVERITY_ORDER.indexOf(cota[dim]) : -1;
      const cur = SEVERITY_ORDER.indexOf(String(level).toUpperCase());
      if (cur > prev) cota[dim] = String(level).toUpperCase();
    }
  }
  const violations = unclassified.map(
    (f) => `${f}: ruta UNCLASSIFIED — clasifícala en .governance/bounded-contexts.yaml (núcleo v5.0, Parte 2.4)`
  );
  const note = `${files.length} archivo(s) cambiado(s) · contextos tocados: ${[...touched].join(", ") || "(ninguno)"} · cota superior: ${
    Object.entries(cota)
      .map(([d, l]) => `${d}=${l}`)
      .join(", ") || "(sin riesgo declarado)"
  }`;
  return { violations, note };
}

function checkEvidence() {
  let doc;
  try {
    doc = loadYaml(".governance/rules.yaml");
  } catch (err) {
    return { violations: [`No se pudo cargar .governance/rules.yaml: ${err.message}`], note: null };
  }
  const rules = Array.isArray(doc.rules) ? doc.rules : [];
  if (rules.length === 0) {
    return { violations: [".governance/rules.yaml no declara reglas"], note: null };
  }
  const violations = [];
  const partial = [];
  for (const rule of rules) {
    const dims = rule?.risk_if_violated?.dimensions || {};
    const critical = CRITICAL_DIMS.filter((d) => String(dims[d]).toUpperCase() === "CRITICAL");
    const level = EVIDENCE_ORDER.indexOf(rule?.evidence_level);
    if (level === -1) {
      violations.push(`${rule.rule_id}: evidence_level inválido (${JSON.stringify(rule?.evidence_level)})`);
      continue;
    }
    if (critical.length > 0 && level < EVIDENCE_ORDER.indexOf("E3")) {
      violations.push(
        `${rule.rule_id}: dimensiones ${critical.join(", ")} CRITICAL exigen evidence_level ≥ E3 (declarado ${rule.evidence_level})`
      );
    }
    if (String(rule?.evidence_status).toUpperCase() === "PARTIAL") partial.push(rule.rule_id);
  }
  const note = partial.length
    ? `reglas con evidencia parcial (aviso informativo): ${partial.join(", ")}`
    : "todas las reglas con evidencia verificada";
  return { violations, note };
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------
const results = {
  "Tokens de diseño (cero hex de marca fuera de la fuente única)": { violations: checkTokens() },
  "Contraste (text-brand-gold nunca como texto; usar text-brand-gold-dark)": {
    violations: checkContrast(),
  },
  'Privacidad (sin select("*") sobre quotes/orders en páginas de cliente)': (() => {
    const { violations, note } = checkPrivacy();
    return { violations, note };
  })(),
  "Waivers vencidos (v5.0)": (() => {
    const { scanned, violations, today, note } = checkWaivers();
    return { violations, scanned, today, note };
  })(),
  "UNCLASSIFIED — rutas sin bounded context (v5.0)": (() => {
    const { violations, note } = checkUnclassified();
    return { violations, note };
  })(),
  "Evidencia mínima por regla (v5.0)": (() => {
    const { violations, note } = checkEvidence();
    return { violations, note };
  })(),
};

console.log("verify:invariants — Manifiesto de Gobernanza de Desarrollo v5.0\n");

let failed = 0;
for (const [name, r] of Object.entries(results)) {
  const ok = (r.violations ?? []).length === 0;
  if (ok) {
    console.log(`✓ ${name}`);
    if (r.note) console.log(`  · ${r.note}`);
    if (r.scanned && r.scanned.length === 0) console.log(`  · sin waivers activos (hoy: ${r.today})`);
    if (r.scanned && r.scanned.length > 0) {
      console.log(`  · ${r.scanned.length} waiver(s) escaneado(s), ninguno vencido (hoy: ${r.today})`);
    }
  } else {
    failed += r.violations.length;
    console.log(`✗ ${name}`);
    for (const v of r.violations) console.log(`  - ${v}`);
  }
}

if (failed > 0) {
  console.log(`\n✗ ${failed} violación(es) de invariantes. Corrige los puntos listados y vuelve a ejecutar \`npm run verify:invariants\`.`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ Las ${Object.keys(results).length} invariantes pasan.`);
}
