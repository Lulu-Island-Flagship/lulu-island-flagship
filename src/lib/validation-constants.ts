import type { ClientType, PreferredLanguage } from "./client-module/types";

// ---------------------------------------------------------------------------
// Single source of truth para constantes de validación.
// Si necesitás una constante que ya existe en otro lado, movela acá.
// ---------------------------------------------------------------------------

export const VALID_CLIENT_TYPES: ClientType[] = ["residential", "commercial", "industrial"];
export const VALID_LANGUAGES: PreferredLanguage[] = ["en", "fr", "es", "zh"];
export const LEGAL_NAME_MIN_LENGTH = 2;
export const LEGAL_NAME_MAX_LENGTH = 200;
