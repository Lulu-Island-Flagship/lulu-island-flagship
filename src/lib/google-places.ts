/**
 * Google Places (New) lookup service — autocompletado de dirección en el
 * paso de dirección del cotizador (StepAddress.tsx).
 *
 * Se llama únicamente server-side (nunca se expone la API key al navegador
 * -- mismo criterio que bc-assessment.ts: la clave viaja solo en el header
 * de esta petición server-to-server, no en un <script> ni en una variable
 * NEXT_PUBLIC_*, así que no hace falta cambiar la CSP ni cargar el SDK
 * pesado de Google Maps JS en el cliente).
 *
 * Si GOOGLE_PLACES_API_KEY no está configurada, ambas funciones devuelven
 * `available: false` explícito -- la UI debe tratar eso como "sin
 * autocompletado, seguir permitiendo escritura manual", nunca como error.
 * Documentado en .env.example.
 */

export interface AddressSuggestion {
  placeId: string;
  description: string;
}

export interface AutocompleteResult {
  available: boolean;
  suggestions: AddressSuggestion[];
  message?: string;
}

export interface PlaceAddressDetails {
  available: boolean;
  address?: string;
  postalCode?: string;
  city?: string;
  message?: string;
}

function getApiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY || undefined;
}

/**
 * Autocompletado de dirección. Sesgado a BC (regionCode "ca") -- el negocio
 * solo opera en Richmond/Vancouver/North Vancouver/West Vancouver/UBC (ver
 * ACTIVE_ZONES en src/lib/pricing.ts), así que no tiene sentido sugerir
 * direcciones fuera de Canadá.
 */
export async function autocompleteAddress(input: string): Promise<AutocompleteResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { available: false, suggestions: [], message: "Google Places provider not configured." };
  }
  if (!input || input.trim().length < 4) {
    return { available: true, suggestions: [] };
  }

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      // Fix (auditoría MANIFEST v4.2 · F.4): timeout explícito para no colgar el
      // proceso serverless si el proveedor no responde.
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
      },
      body: JSON.stringify({
        input: input.trim(),
        regionCode: "ca",
        // Sesgo suave a BC (bounding box aproximado de la zona metro de
        // Vancouver/Richmond) -- no restringe resultados fuera de esta
        // caja, solo los prioriza, para no romper si algún día se agrega
        // una zona fuera de este rango.
        locationBias: {
          rectangle: {
            low: { latitude: 49.0, longitude: -123.3 },
            high: { latitude: 49.35, longitude: -122.9 },
          },
        },
      }),
    });

    if (!response.ok) {
      return { available: false, suggestions: [], message: `Provider returned ${response.status}.` };
    }

    const data = (await response.json()) as {
      suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }>;
    };

    const suggestions: AddressSuggestion[] = (data.suggestions || [])
      .map((s) => ({
        placeId: s.placePrediction?.placeId || "",
        description: s.placePrediction?.text?.text || "",
      }))
      .filter((s) => s.placeId && s.description);

    return { available: true, suggestions };
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { available: false, suggestions: [], message: `Provider lookup failed: ${message}` };
  }
}

/**
 * Detalle de un place seleccionado -- dirección formateada + código postal +
 * localidad (para intentar, best-effort, hacer match contra ACTIVE_ZONES en
 * el componente; nunca se asigna la zona automáticamente aquí, eso es
 * decisión de la UI).
 */
export async function getPlaceAddressDetails(placeId: string): Promise<PlaceAddressDetails> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { available: false, message: "Google Places provider not configured." };
  }
  if (!placeId) {
    return { available: false, message: "placeId is required." };
  }

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "formattedAddress,addressComponents",
        },
      }
    );

    if (!response.ok) {
      return { available: false, message: `Provider returned ${response.status}.` };
    }

    const data = (await response.json()) as {
      formattedAddress?: string;
      addressComponents?: Array<{ longText?: string; types?: string[] }>;
    };

    const components = data.addressComponents || [];
    const postalCode = components.find((c) => c.types?.includes("postal_code"))?.longText;
    // "locality" es la ciudad en la mayoría de direcciones de BC; algunas
    // (ej. UBC) usan "sublocality" o "neighborhood" en vez de locality --
    // se prueban en orden, el primero que exista gana.
    const city =
      components.find((c) => c.types?.includes("locality"))?.longText ||
      components.find((c) => c.types?.includes("sublocality"))?.longText ||
      components.find((c) => c.types?.includes("neighborhood"))?.longText;

    return {
      available: true,
      address: data.formattedAddress,
      postalCode,
      city,
    };
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { available: false, message: `Provider lookup failed: ${message}` };
  }
}
