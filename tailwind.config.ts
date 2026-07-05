import type { Config } from "tailwindcss";

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
          navy: "#0B1E3D",
          "navy-light": "#14315C",
          "wave-blue": "#2E6E96",
          gold: "#C9A961",
          "gold-dark": "#A8863F",
          ink: "#10192B",
          ice: "#F5F5F5",
          white: "#FFFFFF",
        },
        state: {
          success: "#1E7A6E",
          warning: "#B8863F",
          danger: "#C0392B",
          info: "#2E6E96",
        },
      },
      fontFamily: {
        sans: ["var(--font-latin)", "Inter", "sans-serif"],
        cjk: ["var(--font-cjk)", "Noto Sans SC", "sans-serif"],
      },
      boxShadow: {
        "elevation-1": "0 1px 3px rgba(11, 30, 61, 0.08)",
        "elevation-2": "0 4px 12px rgba(11, 30, 61, 0.12)",
        "elevation-3": "0 8px 24px rgba(11, 30, 61, 0.16)",
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "16px",
      },
    },
  },
  plugins: [],
};
export default config;
