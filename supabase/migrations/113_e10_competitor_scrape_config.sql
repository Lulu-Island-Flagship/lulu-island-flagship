-- Migración 113 — v8.3 E10 (D.10.10, Sesión O): habilita el scraping real de
-- competencia sin romper el checklist manual mensual de E1 (criterio de
-- aceptación E10). NO crea tablas nuevas: la 060 ya define
-- competitors / competitor_snapshots / competitor_alerts y ambos orígenes de
-- dato (manual y scraping) siguen escribiendo en la MISMA competitor_snapshots
-- (source distingue el origen, sin cambiar estructura ni UI del panel).
--
-- Estos campos solo agregan CONFIGURACIÓN por competidor de cómo obtener sus
-- datos automáticamente. Por diseño, scrape_enabled nace en FALSE: activar el
-- scraping de un competidor específico es una decisión humana explícita
-- (revisar que su sitio sea público, sin login/paywall, y configurar el
-- patrón de extracción de ESE sitio) — no algo que el sistema decide solo al
-- agregar un competidor. Ningún competidor se scrapea hasta que alguien lo
-- revise y lo prenda a propósito.

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS scrape_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scrape_url TEXT,
  ADD COLUMN IF NOT EXISTS scrape_config JSONB,
  ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_scrape_error TEXT;

COMMENT ON COLUMN competitors.scrape_enabled IS
  'v8.3 E10 Sesión O: false por defecto. Un humano lo activa por competidor tras revisar que scrape_url es una página pública (sin login/paywall) y configurar scrape_config. No hay bypass automático de ningún control de acceso.';
COMMENT ON COLUMN competitors.scrape_url IS
  'URL pública de la página del competidor a scrapear (ej. su página de precios). NULL mientras no esté configurado.';
COMMENT ON COLUMN competitors.scrape_config IS
  'Config de extracción POR COMPETIDOR (ver src/lib/competitor-scraper.ts): patrones regex para precio/servicios/promociones/rating/reseñas sobre el texto plano de la página. No existe un parser universal — cada sitio tiene HTML distinto y este campo lo documenta explícitamente por competidor. Forma esperada: { "priceRegex": "...", "servicesRegex": "...", "promotionsRegex": "...", "ratingRegex": "...", "reviewCountRegex": "...", "notes": "..." }';
COMMENT ON COLUMN competitors.last_scraped_at IS
  'Última vez que el cron semanal intentó scrapear este competidor (haya tenido éxito o no). NULL si nunca se ha intentado.';
COMMENT ON COLUMN competitors.last_scrape_error IS
  'Mensaje del último intento fallido (robots.txt lo prohíbe, fetch falló, regex no encontró el campo obligatorio de precio, etc.). NULL si el último intento fue exitoso o si nunca se ha intentado. Se usa para que el humano sepa que ese competidor necesita revisión de su scrape_config, en vez de fallar en silencio.';
