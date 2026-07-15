/**
 * v8.3 E10 (D.10.2) — "campo obligatorio '¿Cómo nos conociste?'". Sin este
 * campo, `src/lib/attribution.ts` (CAC/LTV/reparto de presupuesto por canal,
 * 100% testeado) nunca tenía datos reales que consumir — quedaba huérfano.
 */

export const ACQUISITION_CHANNELS = [
  "google_search",
  "google_maps",
  "social_media",
  "referral_friend",
  "drive_by",
  "repeat_customer",
  "other",
] as const;

export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

export const ACQUISITION_CHANNEL_LABEL: Record<AcquisitionChannel, string> = {
  google_search: "Google Search",
  google_maps: "Google Maps / Business Profile",
  social_media: "Social Media",
  referral_friend: "Friend / Family Referral",
  drive_by: "Saw our vehicle / drove by",
  repeat_customer: "I'm a returning customer",
  other: "Other",
};

export function isValidAcquisitionChannel(value: unknown): value is AcquisitionChannel {
  return typeof value === "string" && (ACQUISITION_CHANNELS as readonly string[]).includes(value);
}
