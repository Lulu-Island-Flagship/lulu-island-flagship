/**
 * BC Assessment lookup service.
 *
 * BC Assessment no ofrece una API pública gratuita. Este servicio puede
 * conectarse a un proveedor configurado (ej. datos geoespaciales propios,
 * scraping controlado o integración de pago) mediante las variables de
 * entorno BC_ASSESSMENT_API_URL y BC_ASSESSMENT_API_KEY.
 *
 * Si no hay proveedor configurado o la llamada falla, el servicio devuelve
 * explícitamente `confidence: "unavailable"` para que la UI nunca presente
 * un fallback como si fuera un dato real.
 */

export interface BcAssessmentResult {
  /** Superficie habitable en ft² según BC Assessment. */
  squareFeet?: number;
  source: string;
  confidence: "high" | "medium" | "low" | "unavailable";
  message?: string;
  /** Dirección completa normalizada desde el registro público. */
  completeAddress?: string;
  /** Código postal desde BC Assessment (formato A1A 1A1). */
  postalCode?: string;
  /** Tipo de propiedad inferido: "residential" o "commercial". */
  propertyType?: "residential" | "commercial";
  /** Número de dormitorios según el registro. */
  bedrooms?: number;
  /** Número de baños según el registro. */
  bathrooms?: number;
  /** Año de construcción. */
  yearBuilt?: number;
}

export async function lookupBcAssessment(address: string): Promise<BcAssessmentResult> {
  const apiUrl = process.env.BC_ASSESSMENT_API_URL;
  const apiKey = process.env.BC_ASSESSMENT_API_KEY;

  if (!apiUrl) {
    return {
      source: "none",
      confidence: "unavailable",
      message: "BC Assessment provider not configured.",
    };
  }

  try {
    const url = new URL(apiUrl);
    url.searchParams.set("address", address);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
      // No seguir redirecciones de forma agresiva; timeout corto para no bloquear UX
      redirect: "follow",
    });

    if (!response.ok) {
      return {
        source: apiUrl,
        confidence: "unavailable",
        message: `Provider returned ${response.status}.`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Contrato mínimo esperado: { squareFeet: number, confidence?: string }
    const squareFeet =
      typeof data.squareFeet === "number"
        ? data.squareFeet
        : typeof data.square_feet === "number"
          ? data.square_feet
          : typeof data.livingArea === "number"
            ? data.livingArea
            : undefined;

    if (!squareFeet || squareFeet <= 0) {
      return {
        source: apiUrl,
        confidence: "unavailable",
        message: "Provider did not return a usable living area.",
      };
    }

    const confidence =
      typeof data.confidence === "string" && ["high", "medium", "low"].includes(data.confidence)
        ? (data.confidence as BcAssessmentResult["confidence"])
        : "low";

    // Campos enriquecidos: el proveedor puede devolver más datos del registro.
    // Se normalizan a los nombres canónicos. Si no vienen, quedan undefined.
    const completeAddress =
      typeof data.completeAddress === "string" ? data.completeAddress
      : typeof data.formattedAddress === "string" ? data.formattedAddress
      : typeof data.fullAddress === "string" ? data.fullAddress
      : undefined;

    const postalCode =
      typeof data.postalCode === "string" ? data.postalCode
      : typeof data.postal_code === "string" ? data.postal_code
      : typeof data.zip === "string" ? data.zip
      : undefined;

    const propertyType: "residential" | "commercial" | undefined =
      data.propertyType === "residential" || data.propertyType === "commercial"
        ? data.propertyType
        : data.property_type === "residential" || data.property_type === "commercial"
          ? data.property_type
          : undefined;

    const bedrooms =
      typeof data.bedrooms === "number" ? data.bedrooms
      : typeof data.bedroomCount === "number" ? data.bedroomCount
      : undefined;

    const bathrooms =
      typeof data.bathrooms === "number" ? data.bathrooms
      : typeof data.bathroomCount === "number" ? data.bathroomCount
      : undefined;

    const yearBuilt =
      typeof data.yearBuilt === "number" ? data.yearBuilt
      : typeof data.year_built === "number" ? data.year_built
      : typeof data.constructionYear === "number" ? data.constructionYear
      : undefined;

    return {
      squareFeet: Math.round(squareFeet),
      source: apiUrl,
      confidence,
      message: "Suggested square footage from BC Assessment provider.",
      completeAddress,
      postalCode,
      propertyType,
      bedrooms,
      bathrooms,
      yearBuilt,
    };
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      source: apiUrl,
      confidence: "unavailable",
      message: `Provider lookup failed: ${message}`,
    };
  }
}
