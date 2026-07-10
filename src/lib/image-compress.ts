/**
 * v8.3 E4.12 — Fotos comprimidas a WebP antes de subir a Supabase Storage.
 * "Fotos: WebP, máx 1920×1080 y 2MB."
 *
 * Mismo patrón de dos capas que offline-queue.ts / chemical-lockout.ts:
 *  - Funciones puras (aquí, testeables sin navegador): deciden las
 *    dimensiones objetivo, nunca tocan Canvas ni File.
 *  - Wrapper de Canvas (abajo, solo navegador): hace la conversión real.
 *
 * No se agregó ninguna librería externa — el Canvas API nativo del
 * navegador ya soporta `toBlob('image/webp', quality)` en todos los
 * navegadores modernos (incluida la tablet Android 8"+ objetivo de E4),
 * así que es la opción más liviana y sin riesgo de no compilar en el sandbox.
 */

export const MAX_PHOTO_WIDTH = 1920;
export const MAX_PHOTO_HEIGHT = 1080;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2MB
export const THUMBNAIL_SIZE = 300;

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Escala width×height para caber dentro de maxWidth×maxHeight preservando
 * el aspect ratio. Nunca agranda una imagen que ya es más chica.
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxWidth: number = MAX_PHOTO_WIDTH,
  maxHeight: number = MAX_PHOTO_HEIGHT
): Dimensions {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  if (width <= maxWidth && height <= maxHeight) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Dimensiones de un thumbnail "cover" cuadrado (recorta al centro, nunca
 * deforma). Devuelve el tamaño del canvas de salida (siempre size×size) y
 * el rectángulo de origen a recortar de la imagen fuente.
 */
export interface ThumbnailCrop {
  outputSize: number;
  sourceX: number;
  sourceY: number;
  sourceSize: number;
}

export function computeThumbnailCrop(
  width: number,
  height: number,
  size: number = THUMBNAIL_SIZE
): ThumbnailCrop {
  const sourceSize = Math.min(width, height);
  const sourceX = Math.max(0, Math.round((width - sourceSize) / 2));
  const sourceY = Math.max(0, Math.round((height - sourceSize) / 2));
  return { outputSize: size, sourceX, sourceY, sourceSize };
}

/**
 * Calidad WebP a probar en el próximo intento de compresión, dado que el
 * intento anterior dio `lastBytes` y el objetivo es `maxBytes`. Baja la
 * calidad de forma acotada (nunca por debajo de un piso legible) — la
 * decisión de CUÁNTOS intentos hacer vive en el wrapper de Canvas.
 */
export const MIN_WEBP_QUALITY = 0.4;
export const INITIAL_WEBP_QUALITY = 0.82;
export const QUALITY_STEP = 0.12;

export function nextQuality(currentQuality: number, lastBytes: number, maxBytes: number): number {
  if (lastBytes <= maxBytes) return currentQuality;
  return Math.max(MIN_WEBP_QUALITY, currentQuality - QUALITY_STEP);
}

/** ¿Vale la pena seguir intentando bajar la calidad? */
export function shouldRetryCompression(
  currentQuality: number,
  lastBytes: number,
  maxBytes: number
): boolean {
  return lastBytes > maxBytes && currentQuality > MIN_WEBP_QUALITY;
}

// ------------------------------------------------------------
// Wrapper de Canvas (solo navegador — no se testea con node:test)
// ------------------------------------------------------------

export interface CompressedPhoto {
  blob: Blob;
  width: number;
  height: number;
  qualityUsed: number;
}

function loadImageBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function drawToCanvas(
  source: ImageBitmap | HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo obtener contexto 2D del canvas");
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob devolvió null"))),
      "image/webp",
      quality
    );
  });
}

/**
 * Comprime y convierte una foto a WebP, máx 1920×1080, apuntando a ≤2MB.
 * Baja la calidad en pasos hasta cumplir el presupuesto de bytes o llegar
 * al piso de calidad legible.
 */
export async function compressImageToWebP(
  file: File,
  opts: { maxWidth?: number; maxHeight?: number; maxBytes?: number } = {}
): Promise<CompressedPhoto> {
  const maxWidth = opts.maxWidth ?? MAX_PHOTO_WIDTH;
  const maxHeight = opts.maxHeight ?? MAX_PHOTO_HEIGHT;
  const maxBytes = opts.maxBytes ?? MAX_PHOTO_BYTES;

  const source = await loadImageBitmap(file);
  const sourceWidth = "width" in source ? source.width : 0;
  const sourceHeight = "height" in source ? source.height : 0;
  const { width, height } = computeTargetDimensions(sourceWidth, sourceHeight, maxWidth, maxHeight);
  const canvas = drawToCanvas(source, width, height);

  let quality = INITIAL_WEBP_QUALITY;
  let blob = await canvasToBlob(canvas, quality);

  while (shouldRetryCompression(quality, blob.size, maxBytes)) {
    quality = nextQuality(quality, blob.size, maxBytes);
    blob = await canvasToBlob(canvas, quality);
  }

  return { blob, width, height, qualityUsed: quality };
}

/** Thumbnail cuadrado 300×300 en WebP, para grillas/galerías. */
export async function makeThumbnailWebP(
  file: File,
  size: number = THUMBNAIL_SIZE
): Promise<Blob> {
  const source = await loadImageBitmap(file);
  const sourceWidth = "width" in source ? source.width : 0;
  const sourceHeight = "height" in source ? source.height : 0;
  const crop = computeThumbnailCrop(sourceWidth, sourceHeight, size);

  const canvas = document.createElement("canvas");
  canvas.width = crop.outputSize;
  canvas.height = crop.outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo obtener contexto 2D del canvas");
  ctx.drawImage(
    source,
    crop.sourceX,
    crop.sourceY,
    crop.sourceSize,
    crop.sourceSize,
    0,
    0,
    crop.outputSize,
    crop.outputSize
  );

  return canvasToBlob(canvas, 0.8);
}
