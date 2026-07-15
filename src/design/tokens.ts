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
  navy: "#2E5C8A",        // azul cielo profundo — primario, headers, CTA principal (6.97:1 sobre blanco)
  navyLight: "#3E6D9E",   // hover / estados activos
  waveBlue: "#3A6E9E",    // secundario, links, iconografía (5.38:1 sobre blanco)
  gold: "#E3AAB8",        // acento blush — SOLO acentos e insignias, nunca fondos grandes ni texto de cuerpo
  goldDark: "#8A3A46",    // blush con contraste AA real sobre blanco (7.57:1 — ver tests/lib/a11y-audit.test.ts)
  ink: "#1F2E3D",         // texto principal (13.8:1 sobre blanco)
  ice: "#EAF4FB",         // fondo secundario — celeste muy pálido
  white: "#FFFFFF",       // fondo primario
} as const;

export const STATE = {
  success: "#1E7A6E",
  warning: "#B8863F",
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
