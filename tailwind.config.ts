import type { Config } from "tailwindcss";
import { BRAND, STATE, ELEVATION, RADIUS, FONT } from "./src/design/tokens";

/**
 * v8.3 E0-C5: cero valores hex aquí — todo se importa de src/design/tokens.ts
 * (fuente única de tokens de diseño, Parte D.8 del plan).
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          navy: BRAND.navy,
          "navy-light": BRAND.navyLight,
          "wave-blue": BRAND.waveBlue,
          gold: BRAND.gold,
          "gold-dark": BRAND.goldDark,
          ink: BRAND.ink,
          ice: BRAND.ice,
          white: BRAND.white,
        },
        state: {
          success: STATE.success,
          warning: STATE.warning,
          danger: STATE.danger,
          info: STATE.info,
        },
      },
      fontFamily: {
        sans: ["var(--font-latin)", FONT.latin.replace(/'/g, "")],
        cjk: ["var(--font-cjk)", FONT.cjk.replace(/'/g, "")],
      },
      boxShadow: {
        "elevation-1": ELEVATION[1],
        "elevation-2": ELEVATION[2],
        "elevation-3": ELEVATION[3],
      },
      borderRadius: {
        sm: RADIUS.sm,
        md: RADIUS.md,
        lg: RADIUS.lg,
      },
    },
  },
  plugins: [],
};
export default config;
