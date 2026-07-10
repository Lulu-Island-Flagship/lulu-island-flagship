/**
 * v8.3 E6 — Tipos ambiente mínimos para la librería `qrcode` (sin @types
 * publicado). Cubre únicamente la superficie que usa
 * src/lib/review-delivery.ts. Si en el futuro se instala @types/qrcode,
 * este archivo puede borrarse sin cambiar el código que lo consume.
 */
declare module "qrcode" {
  export interface QRCodeToStringOptions {
    type?: "svg" | "utf8" | "terminal";
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    margin?: number;
  }

  export function toString(
    text: string,
    options?: QRCodeToStringOptions
  ): Promise<string>;

  export function toDataURL(
    text: string,
    options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H"; margin?: number }
  ): Promise<string>;
}
