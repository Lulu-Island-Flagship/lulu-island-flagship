/**
 * v8.3 E0-C5 — TOKENS DE DISEÑO — FUENTE ÚNICA (Parte D.8 del plan)
 *
 * REGLA DURA: este es el ÚNICO archivo del repositorio donde pueden existir
 * valores hex de la marca. Tailwind los importa desde aquí y src/app/tokens.css
 * se GENERA desde aquí (npm run tokens). Nunca copiar estos valores a otro archivo.
 *
 * REGLA DE DOS LENGUAJES (invariante B.2.7): esta paleta de MARCA (azul cielo/
 * blush) nunca se mezcla con el código cromático de SEGURIDAD QUÍMICA del
 * Módulo 11 (rojo=baño/ácido, azul=cocina/amonio, ...) — ese código vive en
 * src/lib/chemical-lockout.ts como strings "red"/"blue"/etc. independientes
 * de estos hex, nunca importa BRAND. Uno vende confianza; el otro previene
 * gas cloro. Ningún diseñador futuro debe unificarlos (y con una marca ahora
 * también azul, hay que vigilar esto con más cuidado, no menos).
 *
 * gold (accent blush): solo acentos, insignias y celebraciones — nunca fondos grandes.
 */

export const BRAND = {
  // v8.3 rediseño "Powder Sky" (a petición del dueño: paleta clara/pastel
  // que evoque limpieza, independiente del logo — antes era navy/dorado
  // náutico oscuro). Mismos NOMBRES de token que antes a propósito: cero
  // archivos consumidores tuvieron que tocarse, todo el sitio (público +
  // admin/empleado) hereda el cambio desde esta única fuente.
  navy: "#0B1E3D",        // azul marino oscuro — primario, headers, CTA principal
  navyLight: "#14315C",   // hover / estados activos
  waveBlue: "#2E6E96",    // secundario, links, iconografía
  gold: "#C9A961",        // dorado — SOLO acentos e insignias, nunca fondos grandes ni texto de cuerpo
  // Fix (auditoría MANIFEST v4.2, 2026-08-14 · D.1/a11y): #A8863F daba 3.42:1
  // de contraste sobre blanco (< 4.5:1 AA). Se restaura #93712A (~4.53:1),
  // valor ya establecido en el commit a11y y exigido por el guard en
  // tests/lib/a11y-audit.test.ts.
  goldDark: "#93712A",    // dorado oscuro AA — hover, bordes activos
  ink: "#10192B",         // texto principal
  ice: "#F5F5F5",         // fondo secundario — gris muy pálido
  white: "#FFFFFF",       // fondo primario
} as const;

export const STATE = {
  success: "#1E7A6E",
  // Fix (auditoría transversal 2026-07-25, item 8): #B8863F daba solo
  // 3.22:1 sobre blanco -- falla WCAG AA para texto normal (4.5:1). Se usa
  // como text-state-warning en decenas de sitios con texto text-xs/text-sm
  // (ver p.ej. src/components/cotizador/PriceBreakdown.tsx,
  // src/app/[locale]/reserva/[quoteId]/page.tsx), no solo como decoración
  // grande, así que necesita el umbral de texto normal, no el de 3:1 de
  // texto grande. #946A2C se queda en la misma familia ámbar/dorada y da
  // 4.82:1 (verificado con la fórmula WCAG de src/lib/a11y-audit.ts).
  warning: "#946A2C",
  danger: "#C0392B",
  info: BRAND.waveBlue,
} as const;

export const SPACE = {
  unit: "8px",
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
} as const;

export const RADIUS = {
  sm: "4px",
  md: "8px",
  lg: "16px",
} as const;

export const ELEVATION = {
  1: "0 1px 3px rgba(11, 30, 61, 0.08)",
  2: "0 4px 12px rgba(11, 30, 61, 0.12)",
  3: "0 8px 24px rgba(11, 30, 61, 0.16)",
} as const;

export const FONT = {
  latin: "'Inter', sans-serif",
  cjk: "'Noto Sans SC', sans-serif",
  size: {
    xs: "12px",
    sm: "14px",
    md: "16px",
    lg: "20px",
    xl: "24px",
    "2xl": "32px",
  },
} as const;

/** Variables CSS derivadas — consumidas por el generador de tokens.css */
export function cssVariables(): Record<string, string> {
  return {
    "--brand-navy": BRAND.navy,
    "--brand-navy-light": BRAND.navyLight,
    "--brand-wave-blue": BRAND.waveBlue,
    "--brand-gold": BRAND.gold,
    "--brand-gold-dark": BRAND.goldDark,
    "--brand-ink": BRAND.ink,
    "--brand-ice": BRAND.ice,
    "--brand-white": BRAND.white,
    "--state-success": STATE.success,
    "--state-warning": STATE.warning,
    "--state-danger": STATE.danger,
    "--state-info": STATE.info,
    "--space-unit": SPACE.unit,
    "--space-xs": SPACE.xs,
    "--space-sm": SPACE.sm,
    "--space-md": SPACE.md,
    "--space-lg": SPACE.lg,
    "--space-xl": SPACE.xl,
    "--radius-sm": RADIUS.sm,
    "--radius-md": RADIUS.md,
    "--radius-lg": RADIUS.lg,
    "--elevation-1": ELEVATION[1],
    "--elevation-2": ELEVATION[2],
    "--elevation-3": ELEVATION[3],
    "--font-latin": FONT.latin,
    "--font-cjk": FONT.cjk,
    "--font-size-xs": FONT.size.xs,
    "--font-size-sm": FONT.size.sm,
    "--font-size-md": FONT.size.md,
    "--font-size-lg": FONT.size.lg,
    "--font-size-xl": FONT.size.xl,
    "--font-size-2xl": FONT.size["2xl"],
    "--background": BRAND.white,
    "--foreground": BRAND.ink,
  };
}
