/**
 * v8.3 E4.12 — Tests de la lógica pura de compresión de fotos (sin Canvas).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeTargetDimensions,
  computeThumbnailCrop,
  nextQuality,
  shouldRetryCompression,
  MAX_PHOTO_WIDTH,
  MAX_PHOTO_HEIGHT,
  MIN_WEBP_QUALITY,
  MAX_PHOTO_BYTES,
} from "../../src/lib/image-compress";

describe("computeTargetDimensions", () => {
  it("no agranda una imagen ya más chica que el máximo", () => {
    const result = computeTargetDimensions(800, 600);
    assert.deepEqual(result, { width: 800, height: 600 });
  });

  it("escala hacia abajo preservando el aspect ratio cuando excede el ancho", () => {
    const result = computeTargetDimensions(3840, 2160); // 16:9, 4K
    assert.equal(result.width <= MAX_PHOTO_WIDTH, true);
    assert.equal(result.height <= MAX_PHOTO_HEIGHT, true);
    // 3840x2160 -> escala por altura (2160/1080=2) -> 1920x1080 exacto
    assert.deepEqual(result, { width: 1920, height: 1080 });
  });

  it("escala hacia abajo cuando excede el alto pero no el ancho", () => {
    const result = computeTargetDimensions(1000, 3000);
    assert.equal(result.height, MAX_PHOTO_HEIGHT);
    assert.equal(result.width < 1000, true);
  });

  it("dimensiones inválidas (0 o negativas) devuelven 0x0", () => {
    assert.deepEqual(computeTargetDimensions(0, 500), { width: 0, height: 0 });
    assert.deepEqual(computeTargetDimensions(500, -1), { width: 0, height: 0 });
  });
});

describe("computeThumbnailCrop", () => {
  it("recorta al centro una imagen horizontal ancha", () => {
    const crop = computeThumbnailCrop(1200, 600, 300);
    assert.equal(crop.outputSize, 300);
    assert.equal(crop.sourceSize, 600); // el lado corto
    assert.equal(crop.sourceX, (1200 - 600) / 2);
    assert.equal(crop.sourceY, 0);
  });

  it("recorta al centro una imagen vertical alta", () => {
    const crop = computeThumbnailCrop(600, 1200, 300);
    assert.equal(crop.sourceSize, 600);
    assert.equal(crop.sourceY, (1200 - 600) / 2);
    assert.equal(crop.sourceX, 0);
  });

  it("una imagen ya cuadrada no necesita offset", () => {
    const crop = computeThumbnailCrop(500, 500, 300);
    assert.equal(crop.sourceX, 0);
    assert.equal(crop.sourceY, 0);
    assert.equal(crop.sourceSize, 500);
  });
});

describe("nextQuality / shouldRetryCompression", () => {
  it("si el tamaño ya cumple el presupuesto, mantiene la calidad", () => {
    assert.equal(nextQuality(0.8, 1_000_000, MAX_PHOTO_BYTES), 0.8);
  });

  it("si excede el presupuesto, baja la calidad un paso, con piso", () => {
    const q = nextQuality(0.8, 5_000_000, MAX_PHOTO_BYTES);
    assert.equal(q < 0.8, true);
    assert.equal(q >= MIN_WEBP_QUALITY, true);
  });

  it("nunca baja la calidad por debajo del piso", () => {
    const q = nextQuality(MIN_WEBP_QUALITY, 5_000_000, MAX_PHOTO_BYTES);
    assert.equal(q, MIN_WEBP_QUALITY);
  });

  it("deja de reintentar al llegar al piso de calidad aunque siga pesado", () => {
    assert.equal(shouldRetryCompression(MIN_WEBP_QUALITY, 5_000_000, MAX_PHOTO_BYTES), false);
  });

  it("deja de reintentar en cuanto el tamaño cumple el presupuesto", () => {
    assert.equal(shouldRetryCompression(0.7, 1_000_000, MAX_PHOTO_BYTES), false);
  });

  it("sigue reintentando mientras pese de más y quede margen de calidad", () => {
    assert.equal(shouldRetryCompression(0.7, 5_000_000, MAX_PHOTO_BYTES), true);
  });
});
