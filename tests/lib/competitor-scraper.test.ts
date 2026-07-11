import { describe, it } from "node:test";
import assert from "node:assert";
import {
  parseRobotsDisallowRules,
  isPathAllowed,
  stripHtmlToText,
  extractWithRegex,
  parsePriceToCents,
  parseRatingValue,
  parseReviewCountValue,
  parseDelimitedList,
  extractCompetitorData,
  type ScrapeConfig,
} from "../../src/lib/competitor-scraper";

describe("parseRobotsDisallowRules", () => {
  it("extrae Disallow del grupo User-agent: *", () => {
    const robots = "User-agent: *\nDisallow: /admin\nDisallow: /private\n";
    assert.deepEqual(parseRobotsDisallowRules(robots), ["/admin", "/private"]);
  });

  it("ignora grupos de otros user-agents", () => {
    const robots = "User-agent: Googlebot\nDisallow: /solo-google\nUser-agent: *\nDisallow: /todos\n";
    assert.deepEqual(parseRobotsDisallowRules(robots), ["/todos"]);
  });

  it("sin ningun User-agent declarado, no hay reglas (permitido por convencion)", () => {
    assert.deepEqual(parseRobotsDisallowRules("Sitemap: /sitemap.xml"), []);
  });

  it("ignora comentarios y lineas vacias", () => {
    const robots = "# comentario\nUser-agent: *\n\nDisallow: /x # otro comentario\n";
    assert.deepEqual(parseRobotsDisallowRules(robots), ["/x"]);
  });
});

describe("isPathAllowed", () => {
  it("permitido si no hay prefijo que matchee", () => {
    assert.equal(isPathAllowed(["/admin"], "/precios"), true);
  });

  it("bloqueado si el path empieza con un prefijo disallow", () => {
    assert.equal(isPathAllowed(["/admin"], "/admin/secreto"), false);
  });

  it("Disallow vacio (\"\") no bloquea nada", () => {
    assert.equal(isPathAllowed([""], "/cualquier-cosa"), true);
  });
});

describe("stripHtmlToText", () => {
  it("quita tags y colapsa espacios", () => {
    const html = "<div>  <p>Precio: <b>$89.99</b></p>  </div>";
    assert.equal(stripHtmlToText(html), "Precio: $89.99");
  });

  it("elimina contenido de script y style", () => {
    const html = "<style>.a{color:red}</style><p>Texto real</p><script>alert(1)</script>";
    assert.equal(stripHtmlToText(html), "Texto real");
  });

  it("decodifica entidades comunes", () => {
    const html = "<p>Tom &amp; Jerry &mdash;test&nbsp;&quot;ok&quot;</p>".replace("&mdash;", "");
    assert.ok(stripHtmlToText(html).includes('Tom & Jerry'));
    assert.ok(stripHtmlToText(html).includes('"ok"'));
  });
});

describe("extractWithRegex", () => {
  it("devuelve el grupo de captura si existe", () => {
    assert.equal(extractWithRegex("Precio: $89.99 por hora", "Precio:\\s*\\$([\\d.]+)"), "89.99");
  });

  it("devuelve el match completo si no hay grupo de captura", () => {
    assert.equal(extractWithRegex("Precio: $89.99", "\\$[\\d.]+"), "$89.99");
  });

  it("devuelve null si no hay match", () => {
    assert.equal(extractWithRegex("sin numeros aqui", "\\$[\\d.]+"), null);
  });

  it("devuelve null (no revienta) con un regex invalido", () => {
    assert.equal(extractWithRegex("texto", "("), null);
  });
});

describe("parsePriceToCents", () => {
  it("parsea formato simple con simbolo de moneda", () => {
    assert.equal(parsePriceToCents("$89.99"), 8999);
  });

  it("parsea formato con separador de miles y decimales", () => {
    assert.equal(parsePriceToCents("$1,299.00"), 129900);
  });

  it("parsea formato con coma decimal (sin punto)", () => {
    assert.equal(parsePriceToCents("89,99"), 8999);
  });

  it("devuelve null si no hay digitos", () => {
    assert.equal(parsePriceToCents("gratis"), null);
  });
});

describe("parseRatingValue", () => {
  it("parsea un rating valido", () => {
    assert.equal(parseRatingValue("4.5 de 5 estrellas"), 4.5);
  });

  it("devuelve null fuera de rango 0-5", () => {
    assert.equal(parseRatingValue("8.2"), null);
  });

  it("devuelve null sin numero", () => {
    assert.equal(parseRatingValue("sin rating"), null);
  });
});

describe("parseReviewCountValue", () => {
  it("parsea conteo con comas de miles", () => {
    assert.equal(parseReviewCountValue("1,204 reseñas"), 1204);
  });

  it("devuelve null sin digitos", () => {
    assert.equal(parseReviewCountValue("sin reseñas"), null);
  });
});

describe("parseDelimitedList", () => {
  it("separa por coma y limpia espacios", () => {
    assert.deepEqual(parseDelimitedList("Limpieza, Jardineria ,  Piscinas"), ["Limpieza", "Jardineria", "Piscinas"]);
  });

  it("filtra entradas vacias", () => {
    assert.deepEqual(parseDelimitedList("A,,B,"), ["A", "B"]);
  });
});

describe("extractCompetitorData", () => {
  const text = "Precio: $89.99 por hora. Servicios: Limpieza, Jardineria. Promo: 10% descuento primer mes. Rating: 4.3 de 5 (120 reseñas)";

  it("extrae todos los campos cuando el config esta completo y matchea", () => {
    const config: ScrapeConfig = {
      priceRegex: "Precio:\\s*\\$([\\d.,]+)",
      servicesRegex: "Servicios:\\s*([^.]+)\\.",
      promotionsRegex: "Promo:\\s*([^.]+)",
      ratingRegex: "Rating:\\s*([\\d.]+)",
      reviewCountRegex: "\\((\\d+) rese",
    };
    const result = extractCompetitorData(text, config);
    assert.equal(result.priceCents, 8999);
    assert.deepEqual(result.services, ["Limpieza", "Jardineria"]);
    assert.deepEqual(result.activePromotions, ["10% descuento primer mes"]);
    assert.equal(result.averageRating, 4.3);
    assert.equal(result.reviewCount, 120);
    assert.equal(result.warnings.length, 0);
  });

  it("campo sin config configurado queda null/[] con warning honesto, no inventa nada", () => {
    const config: ScrapeConfig = { priceRegex: "Precio:\\s*\\$([\\d.,]+)" };
    const result = extractCompetitorData(text, config);
    assert.equal(result.priceCents, 8999);
    assert.deepEqual(result.services, []);
    assert.ok(result.warnings.some((w) => w.includes("servicios") && w.includes("sin patrón configurado")));
  });

  it("regex configurado que no matchea reporta warning de recalibracion, no inventa valor", () => {
    const config: ScrapeConfig = { priceRegex: "PatronQueNuncaVaAMatchear999" };
    const result = extractCompetitorData(text, config);
    assert.equal(result.priceCents, null);
    assert.ok(result.warnings.some((w) => w.includes("precio") && w.includes("recalibrar")));
  });
});
