/**
 * Guard de regresión legal (auditoría 2026-08-01): messages/{en,fr,zh}.json
 * tenían un claim público de "bonded" (EN) / "cautionné" (FR) / "担保" (ZH)
 * en trust.verifiedDescInsured -- una afirmación de fianza/garantía que
 * `isPublicInsuredClaimReady()` (src/lib/business-insurance.ts) NUNCA
 * verifica: esa función solo confirma 3 pólizas de SEGURO (vehicular,
 * general_liability, errors_omissions), no una fianza. O sea que aunque el
 * flag `insuredClaimReady` se active legítimamente (seguros reales
 * contratados), el texto "bonded" seguía siendo una afirmación sin
 * respaldo -- el gating por flag no alcanza porque el problema está en la
 * palabra misma, no en cuándo se muestra.
 *
 * Este test evita que "bonded"/"cautionné"/"担保" (u otras variantes de
 * fianza/garantía) vuelvan a colarse en el copy PÚBLICO de los 3 locales.
 * Se excluye el namespace `admin.*` a propósito: ese copy es UI interna
 * para el dueño del negocio que DESCRIBE la regla B.2.25/B.4 (menciona las
 * palabras entre comillas para explicar qué se bloquea), no un claim
 * publicado en el sitio.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const LOCALES = ["en", "fr", "zh"] as const;

// Patrones de "fianza/garantía" (bonding) por idioma. Deliberadamente NO
// incluyen "insured"/"assurée"/"投保" (seguro) porque esos SÍ están
// correctamente respaldados por el flag `insuredClaimReady`, que valida
// pólizas de seguro reales -- el problema era específicamente "bonded" y
// sus traducciones, que no tienen ningún mecanismo de verificación.
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bbonded\b/i,
  /\bbonding\b/i,
  /\bfidelity[- ]bond(ed)?\b/i,
  /cautionn?é/i, // cautionné / cautionne
  /担保/,
];

function loadMessages(locale: string): Record<string, unknown> {
  const filePath = path.join(__dirname, "..", "..", "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Recorre el árbol de mensajes y devuelve [ruta, valor] para cada string
 * hoja, excluyendo el subárbol `admin` (copy interno que describe la regla,
 * no un claim público).
 */
function collectPublicStrings(obj: unknown, pathPrefix: string[] = []): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (typeof obj === "string") {
    out.push([pathPrefix.join("."), obj]);
    return out;
  }
  if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (pathPrefix.length === 0 && key === "admin") continue; // UI interna, no público
      out.push(...collectPublicStrings(value, [...pathPrefix, key]));
    }
  }
  return out;
}

describe("i18n: claims legales prohibidos (bonded/cautionné/担保)", () => {
  for (const locale of LOCALES) {
    it(`messages/${locale}.json parsea como JSON válido`, () => {
      assert.doesNotThrow(() => loadMessages(locale));
    });

    it(`messages/${locale}.json no contiene claims públicos de "bonded" sin respaldo`, () => {
      const messages = loadMessages(locale);
      const publicStrings = collectPublicStrings(messages);
      const offenders = publicStrings.filter(([, value]) =>
        FORBIDDEN_PATTERNS.some((pattern) => pattern.test(value))
      );
      assert.deepEqual(
        offenders,
        [],
        `Se encontraron claims de fianza/garantía sin respaldo en ${locale}.json: ${JSON.stringify(offenders)}`
      );
    });
  }
});
