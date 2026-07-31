import { NextResponse } from "next/server";

/**
 * Fix auditoría 2026-07-30 (BUG-1 CRÍTICO): varias rutas API devolvían
 * `error.message` (o `err.message`) crudo al cliente en respuestas 500,
 * filtrando potencialmente nombres de tablas, columnas, RPCs o políticas
 * RLS de Postgres/Supabase directamente en la respuesta JSON.
 *
 * `safeErrorResponse` centraliza el manejo: registra el error completo
 * server-side (con contexto opcional) vía console.error, y devuelve al
 * cliente únicamente un mensaje genérico seguro, nunca el detalle interno.
 */
export function safeErrorResponse(
  error: unknown,
  status = 500,
  publicMessage = "Internal server error"
) {
  console.error(publicMessage, error);
  return NextResponse.json({ error: publicMessage }, { status });
}
