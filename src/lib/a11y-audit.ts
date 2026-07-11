/**
 * v8.3 E6-C7 — Auditoría de accesibilidad, funciones puras.
 *
 * CONTEXTO REAL (léase antes de confiar en esto): el criterio de aceptación
 * de E6 pide "auditoría automatizada de accesibilidad (axe o similar) sin
 * errores críticos en las 3 superficies". Este repo no tiene Playwright,
 * jsdom, ni ningún runner con DOM real — `npm test` es `tsx --test` puro
 * sobre funciones de src/lib/. axe-core real necesita un DOM renderizado
 * (navegador o jsdom) para poder inspeccionar el árbol de accesibilidad
 * calculado (roles, estados, contraste computado tras CSS en cascada).
 * Este módulo NO es axe-core: es un sustituto deliberadamente más débil,
 * dividido en dos verificaciones que SÍ son 100% verificables sin navegador:
 *
 *  1. Contraste WCAG 2.1 AA real, calculado matemáticamente sobre los
 *     colores reales de la fuente única (src/design/tokens.ts) — esto es
 *     tan válido como lo que haría axe, porque el contraste no depende del
 *     layout, solo de los dos colores.
 *  2. Un escaneo estático (regex sobre el texto fuente) de patrones de
 *     marcado que rompen accesibilidad: <img> sin alt, campos de formulario
 *     sin nombre accesible, controles interactivos sin nombre accesible,
 *     elementos no interactivos con onClick sin rol/tabIndex de teclado,
 *     tabIndex positivo (rompe el orden natural del tab).
 *
 * LO QUE ESTO NO VERIFICA (limitación real, no ocultar):
 *  - Contraste real en pantalla tras cascada de CSS/Tailwind arbitrario
 *    (solo verifica las combinaciones de la paleta de marca declaradas aquí).
 *  - Navegación por teclado dinámica real (focus trap, orden de tab en
 *    interacciones con JS, modales).
 *  - Lectores de pantalla reales (NVDA/VoiceOver) ni el árbol de
 *    accesibilidad calculado por el navegador.
 *  - Asociación real label→input cuando se hace por anidamiento JSX
 *    (`<label>Texto<input /></label>`) en vez de htmlFor/id — el escaneo
 *    aquí es a nivel de archivo completo, no de anidamiento AST, así que
 *    puede dar falsos negativos en ese caso (ver `scanSource`).
 *
 * Por eso el criterio real que este módulo puede reclamar es más angosto
 * que el literal del plan: "cero violaciones de un linter estático de
 * patrones conocidos + contraste matemático de la paleta de marca", no
 * "auditoría axe completa". Debe declararse así en el reporte de etapa.
 */

// ---------------------------------------------------------------------------
// 1. Contraste WCAG 2.1 AA
// ---------------------------------------------------------------------------

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`Color hex inválido: "${hex}"`);
  }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa (WCAG 2.1 §1.4.3, fórmula oficial). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** Ratio de contraste entre dos colores (1:1 a 21:1). */
export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG 2.1 AA: 4.5:1 para texto normal, 3:1 para texto grande
 * (≥24px o ≥19px bold — criterio 1.4.3).
 */
export function meetsWcagAA(ratio: number, isLargeText = false): boolean {
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}

export interface ContrastCheck {
  label: string;
  foreground: string;
  background: string;
  ratio: number;
  isLargeText: boolean;
  passesAA: boolean;
}

export function checkContrastPair(
  label: string,
  foreground: string,
  background: string,
  isLargeText = false
): ContrastCheck {
  const ratio = contrastRatio(foreground, background);
  return {
    label,
    foreground,
    background,
    ratio: Math.round(ratio * 100) / 100,
    isLargeText,
    passesAA: meetsWcagAA(ratio, isLargeText),
  };
}

// ---------------------------------------------------------------------------
// 2. Escaneo estático de patrones de marcado (heurístico, no AST)
// ---------------------------------------------------------------------------

export type A11ySeverity = "critical" | "warning";

export interface A11yIssue {
  rule: string;
  severity: A11ySeverity;
  message: string;
  file: string;
  line: number;
  snippet: string;
}

interface Rule {
  id: string;
  severity: A11ySeverity;
  /** Debe devolver un array de {index, snippet, message} para cada hallazgo. */
  find(source: string): Array<{ index: number; snippet: string; message: string }>;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function matchesTag(tag: string): RegExp {
  // Captura la etiqueta de apertura completa, con o sin auto-cierre.
  return new RegExp(`<${tag}\\b[^>]*?(?:/>|>)`, "g");
}

/**
 * Sustituto de `source.matchAll(re)` + `for...of` que no requiere
 * downlevelIteration ni target >= es2015: el tsconfig del repo no fija
 * `target`, así que TS asume ES3 y matchAll+for-of no compila ahí. Con
 * exec()+while el resultado es idéntico y compatible con cualquier target.
 */
function execAll(re: RegExp, source: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push(m);
    if (m[0].length === 0) re.lastIndex++; // evita loop infinito en matches vacíos
  }
  return out;
}

const RULES: Rule[] = [
  {
    id: "img-sin-alt",
    severity: "critical",
    find(source) {
      const out: Array<{ index: number; snippet: string; message: string }> = [];
      for (const m of execAll(matchesTag("img"), source)) {
        const tag = m[0];
        if (!/\balt\s*=/.test(tag)) {
          out.push({
            index: m.index ?? 0,
            snippet: tag,
            message: "<img> sin atributo alt (WCAG 1.1.1 — Contenido no textual).",
          });
        }
      }
      return out;
    },
  },
  {
    id: "campo-sin-nombre-accesible",
    severity: "critical",
    find(source) {
      const out: Array<{ index: number; snippet: string; message: string }> = [];
      for (const tag of ["input", "select", "textarea"]) {
        for (const m of execAll(matchesTag(tag), source)) {
          const t = m[0];
          if (/type\s*=\s*["']hidden["']/.test(t)) continue;
          const hasAriaLabel = /\baria-label\s*=/.test(t);
          const hasAriaLabelledby = /\baria-labelledby\s*=/.test(t);
          const hasId = /\bid\s*=/.test(t);
          const hasTitle = /\btitle\s*=/.test(t);
          if (!hasAriaLabel && !hasAriaLabelledby && !hasId && !hasTitle) {
            out.push({
              index: m.index ?? 0,
              snippet: t,
              message: `<${tag}> sin aria-label/aria-labelledby/id/title — no se puede confirmar nombre accesible (WCAG 4.1.2). Nota: si el label lo envuelve por anidamiento JSX, este escaneo puede dar falso positivo; revisar manualmente.`,
            });
          }
        }
      }
      return out;
    },
  },
  {
    id: "boton-icono-sin-nombre",
    severity: "critical",
    find(source) {
      const out: Array<{ index: number; snippet: string; message: string }> = [];
      const buttonRe = /<button\b[^>]*?>([\s\S]*?)<\/button>/g;
      for (const m of execAll(buttonRe, source)) {
        const openTag = m[0].slice(0, m[0].indexOf(">") + 1);
        const inner = m[1];
        const hasAriaLabel = /\baria-label\s*=/.test(openTag);
        const hasAriaLabelledby = /\baria-labelledby\s*=/.test(openTag);
        // Texto visible = hay al menos una secuencia de letras/números fuera de tags.
        const visibleText = inner.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "").trim();
        const hasVisibleText = /[a-zA-Z0-9À-ɏ一-鿿]/.test(visibleText);
        if (!hasAriaLabel && !hasAriaLabelledby && !hasVisibleText) {
          out.push({
            index: m.index ?? 0,
            snippet: openTag,
            message: "<button> sin texto visible ni aria-label/aria-labelledby (WCAG 4.1.2 — probable botón de solo ícono sin nombre accesible).",
          });
        }
      }
      return out;
    },
  },
  {
    id: "clic-sin-teclado",
    severity: "critical",
    find(source) {
      const out: Array<{ index: number; snippet: string; message: string }> = [];
      for (const tag of ["div", "span"]) {
        for (const m of execAll(matchesTag(tag), source)) {
          const t = m[0];
          if (!/\bonClick\s*=/.test(t)) continue;
          const hasRole = /\brole\s*=/.test(t);
          const hasTabIndex = /\btabIndex\s*=/.test(t);
          if (!hasRole || !hasTabIndex) {
            out.push({
              index: m.index ?? 0,
              snippet: t,
              message: `<${tag} onClick> sin role+tabIndex — no es alcanzable ni operable por teclado (WCAG 2.1.1 — Teclado).`,
            });
          }
        }
      }
      return out;
    },
  },
  {
    id: "tabindex-positivo",
    severity: "warning",
    find(source) {
      const out: Array<{ index: number; snippet: string; message: string }> = [];
      const re = /tabIndex\s*=\s*\{?["']?(\d+)["']?\}?/g;
      for (const m of execAll(re, source)) {
        const value = parseInt(m[1], 10);
        if (value > 0) {
          out.push({
            index: m.index ?? 0,
            snippet: m[0],
            message: "tabIndex positivo rompe el orden natural de tabulación (WCAG 2.4.3 — Orden del foco).",
          });
        }
      }
      return out;
    },
  },
  {
    id: "viewport-bloquea-zoom",
    severity: "critical",
    find(source) {
      const out: Array<{ index: number; snippet: string; message: string }> = [];
      // No exigimos que "viewport" aparezca en el mismo match: estos dos
      // atributos solo tienen sentido dentro de un content de viewport, así
      // que basta con encontrarlos en el archivo (heurístico, no AST).
      const re = /(user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?\b)/gi;
      for (const m of execAll(re, source)) {
        out.push({
          index: m.index ?? 0,
          snippet: m[0],
          message: "Meta viewport bloquea zoom (user-scalable=no o maximum-scale=1) — impide escalar texto a 200% (WCAG 1.4.4).",
        });
      }
      return out;
    },
  },
];

/** Escanea una fuente JSX/TSX y devuelve issues con línea calculada. */
export function scanSource(source: string, file: string): A11yIssue[] {
  const issues: A11yIssue[] = [];
  for (const rule of RULES) {
    for (const hit of rule.find(source)) {
      issues.push({
        rule: rule.id,
        severity: RULES.find((r) => r.id === rule.id)!.severity,
        message: hit.message,
        file,
        line: lineOf(source, hit.index),
        snippet: hit.snippet.slice(0, 160),
      });
    }
  }
  return issues;
}

export function isCritical(issue: A11yIssue): boolean {
  return issue.severity === "critical";
}
