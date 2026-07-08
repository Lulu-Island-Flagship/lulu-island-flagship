/**
 * Geocodificación ligera para direcciones de servicio.
 *
 * Por defecto usa Nominatim (OpenStreetMap) con límite de 1 resultado.
 * Para producción de alto volumen se recomienda configurar un proveedor
 * pagado (Google Maps, Mapbox, etc.) vía la variable de entorno
 * GEOCODER_PROVIDER_URL / GEOCODER_API_KEY.
 *
 * Nominatim requiere un User-Agent descriptivo y no debe usarse para
 * más de 1 petición/segundo. Este helper está pensado para crear la
 * cotización (bajo volumen). Si falla, devuelve null y la geocerca
 * permite bypass manual con advertencia.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Convierte grados a radianes.
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Distancia Haversine entre dos puntos en metros.
 */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat2 = Math.sin(dLat / 2);
  const sinDLng2 = Math.sin(dLng / 2);

  const h =
    sinDLat2 * sinDLat2 +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng2 * sinDLng2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/**
 * Geocodifica una dirección canadiense. Añade ", Canada" si no está presente
 * para mejorar la precisión con Nominatim.
 */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const providerUrl = process.env.GEOCODER_PROVIDER_URL;
  const apiKey = process.env.GEOCODER_API_KEY;

  if (providerUrl) {
    // Proveedor configurado por el operador (Google, Mapbox, etc.)
    try {
      const url = providerUrl
        .replace("{address}", encodeURIComponent(address))
        .replace("{key}", encodeURIComponent(apiKey || ""));
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const json = await res.json();
      // Adapter genérico: intenta leer lat/lng de formatos comunes
      const lat =
        json?.lat ?? json?.results?.[0]?.geometry?.location?.lat ?? json?.[0]?.lat;
      const lng =
        json?.lon ??
        json?.lng ??
        json?.results?.[0]?.geometry?.location?.lng ??
        json?.[0]?.lon;
      if (typeof lat === "number" && typeof lng === "number") {
        return { lat, lng };
      }
    } catch (err) {
      console.error("Configured geocoder error:", err);
    }
    return null;
  }

  // Fallback: Nominatim (OpenStreetMap)
  const query = address.toLowerCase().includes("canada")
    ? address
    : `${address}, Canada`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    query
  )}&limit=1`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "LuluIslandFlagship/1.0 (support@luluislandflagship.ca)",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return { lat, lng: lon };
  } catch (err) {
    console.error("Nominatim geocode error:", err);
    return null;
  }
}

/**
 * Radio de geocerca para considerar que el empleado está en el sitio.
 */
export const GEOFENCE_RADIUS_METERS = 200;
