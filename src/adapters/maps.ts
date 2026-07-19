/**
 * v8.3 E0.8 — Adaptador de mapas/geocodificación (Google Maps API).
 *
 * Re-exporta `src/lib/geocode.ts` bajo el punto de importación estable del
 * adaptador. `geocodeAddress` ya está aislada del proveedor concreto — si
 * cambia de Google Maps a otro geocoder, el cambio ocurre en geocode.ts y
 * este archivo no necesita tocarse.
 */

export {
  geocodeAddress,
  haversineDistance,
  MEETING_POINT_RADIUS_METERS,
  ARRIVAL_GEOFENCE_RADIUS_METERS,
  type LatLng,
} from "@/lib/geocode";

import { geocodeAddress, type LatLng } from "@/lib/geocode";

/**
 * v8.3 E0 (auditoría 2026-07-18) — interfaz abstracta mínima + mock. Solo
 * cubre `geocodeAddress` (la única llamada de red real del módulo) --
 * `haversineDistance` es matemática pura, sin proveedor externo, y no
 * necesita mockearse.
 */
export interface MapsAdapter {
  geocodeAddress(address: string): Promise<LatLng | null>;
}

export const mapsAdapter: MapsAdapter = { geocodeAddress };

export function createMockMapsAdapter(overrides?: Partial<MapsAdapter>): MapsAdapter {
  return {
    geocodeAddress: async (_address: string) => ({ lat: 49.2827, lng: -123.1207 }), // Vancouver, BC — valor determinista de prueba
    ...overrides,
  };
}
