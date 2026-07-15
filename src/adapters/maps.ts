/**
 * v8.3 E0.8 — Adaptador de mapas/geocodificación (Google Maps API).
 *
 * Re-exporta `src/lib/geocode.ts` bajo el punto de importación estable del
 * adaptador. `geocodeAddress` ya está aislada del proveedor concreto — si
 * cambia de Google Maps a otro geocoder, el cambio ocurre en geocode.ts y
 * este archivo no necesita tocarse.
 */

export { geocodeAddress, haversineDistance, GEOFENCE_RADIUS_METERS, type LatLng } from "@/lib/geocode";
