/**
 * Verificación server-side de transacciones de PayPal.
 *
 * Soporta tanto capture IDs (pagos completados) como order IDs.
 * Requiere PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET en variables de entorno.
 */

export interface PayPalVerificationResult {
  valid: boolean;
  transactionId: string;
  status?: string;
  amount?: number; // dollars CAD
  currency?: string;
  payerEmail?: string;
  error?: string;
}

// Fix B-P2-PAYPAL-ENV (auditoría externa 2026-07-24): antes, cualquier valor
// de PAYPAL_ENVIRONMENT que no fuera EXACTAMENTE "live" (ausente, vacío, o
// mal escrito como "Live"/"production") caía SILENCIOSAMENTE en sandbox, sin
// log ni excepción -- incluso en producción real. Esto afectaba tanto
// verifyPayPalTransaction (verificación de pagos) como refundPayPalCapture
// (reembolsos reales de dinero): en producción, una variable faltante o mal
// configurada apuntaría en silencio al sandbox -- un cliente "pagaría" sin
// que hubiera dinero real de por medio, o un "reembolso" no devolvería nada
// real. Ahora las 3 combinaciones son explícitas (live / sandbox /
// inesperado) y, en producción, un valor inesperado falla ruidosamente
// (throw) en vez de defaultear en silencio. Fuera de producción se mantiene
// el default seguro a sandbox.
function getPayPalBaseUrl(): string {
  const env = process.env.PAYPAL_ENVIRONMENT;
  const isProduction =
    process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

  if (env === "live") {
    return "https://api.paypal.com";
  }

  if (env === "sandbox") {
    return "https://api.sandbox.paypal.com";
  }

  // env es undefined, vacío, o algo inesperado (typo, etc.)
  if (isProduction) {
    throw new Error(
      `PAYPAL_ENVIRONMENT inválido o ausente en producción: "${env}". ` +
        `Debe ser exactamente "live" o "sandbox". Fallando en vez de ` +
        `defaultear en silencio a sandbox (ver fix B-P2-PAYPAL-ENV, 2026-07-24).`
    );
  }

  // Fuera de producción (dev/test/preview): default seguro a sandbox.
  return "https://api.sandbox.paypal.com";
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials not configured");
  }

  const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function fetchCapture(
  accessToken: string,
  transactionId: string
): Promise<PayPalVerificationResult | null> {
  const res = await fetch(`${getPayPalBaseUrl()}/v2/payments/captures/${transactionId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text();
    throw new Error(`PayPal capture lookup failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: string;
    amount: { value: string; currency_code: string };
  };

  return {
    valid: data.status === "COMPLETED",
    transactionId: data.id,
    status: data.status,
    amount: Number(data.amount.value),
    currency: data.amount.currency_code,
  };
}

async function fetchOrder(
  accessToken: string,
  transactionId: string
): Promise<PayPalVerificationResult | null> {
  const res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${transactionId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text();
    throw new Error(`PayPal order lookup failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: string;
    purchase_units?: Array<{
      amount: { value: string; currency_code: string };
      payments?: {
        captures?: Array<{ id: string; status: string; amount: { value: string; currency_code: string } }>;
      };
    }>;
    payer?: { email_address?: string };
  };

  const captures = data.purchase_units?.[0]?.payments?.captures;
  const completedCapture = captures?.find((c) => c.status === "COMPLETED");
  const capture = completedCapture ?? captures?.[0];
  const amountValue = capture?.amount?.value ?? data.purchase_units?.[0]?.amount?.value;
  const currencyCode = capture?.amount?.currency_code ?? data.purchase_units?.[0]?.amount?.currency_code;

  // Fix (auditoría externa, verificado 2026-07-31): antes se aceptaba un
  // order con status "APPROVED" como pago válido, aunque nunca se hubiera
  // ejecutado la captura (el dinero nunca sale de la cuenta del pagador).
  // Un order "aprobado" pero no capturado es reversible por el pagador sin
  // que nosotros nos enteremos -- tratarlo como pago válido es un bug
  // financiero crítico. Ahora exigimos que exista al menos una captura real
  // con status "COMPLETED"; el status de nivel superior del order ya no es
  // suficiente por sí solo.
  const valid = completedCapture !== undefined;

  return {
    valid,
    transactionId: data.id,
    status: completedCapture ? completedCapture.status : data.status,
    amount: amountValue ? Number(amountValue) : undefined,
    currency: currencyCode,
    payerEmail: data.payer?.email_address,
  };
}

export interface PayPalRefundResult {
  success: boolean;
  refundId?: string;
  status?: string;
  error?: string;
}

/**
 * Reembolsa (total o parcialmente) una captura de PayPal ya completada.
 * Fix B-P2-3 (auditoría 2026-07-21): cron/paypal-refunds nunca llamaba a
 * ningún endpoint real de PayPal, solo dejaba un TODO + console.log.
 *
 * @param captureId ID de la captura de PayPal (orders.paypal_transaction_id).
 * @param amount Monto a reembolsar en dólares CAD (opcional; si se omite,
 *   PayPal reembolsa el monto completo de la captura).
 * @param noteToPayer Nota visible para el pagador (opcional).
 */
export async function refundPayPalCapture(
  captureId: string,
  amount?: number,
  noteToPayer?: string
): Promise<PayPalRefundResult> {
  try {
    const accessToken = await getAccessToken();

    const body: Record<string, unknown> = {};
    if (amount !== undefined) {
      body.amount = { value: amount.toFixed(2), currency_code: "CAD" };
    }
    if (noteToPayer) {
      body.note_to_payer = noteToPayer.slice(0, 255);
    }

    // Fix (auditoría externa, verificado 2026-07-31): la idempotency key
    // usaba SOLO el captureId, idéntica para CUALQUIER reembolso posterior
    // de esa misma captura. PayPal deduplica peticiones con el mismo
    // PayPal-Request-Id devolviendo la respuesta cacheada del primer
    // reembolso -- así, un reembolso parcial legítimo #2 sobre la misma
    // captura (distinto monto) sería silenciosamente IGNORADO por PayPal
    // (se devolvería la respuesta del primer reembolso), y nuestro código
    // creería que se procesó el segundo.
    //
    // OJO: se incluye el monto para diferenciar reembolsos de distinto
    // valor, pero DELIBERADAMENTE se mantiene determinística (sin UUID
    // aleatorio) -- el único llamador actual (cron/paypal-refunds) reintenta
    // la MISMA orden con el MISMO monto en corridas posteriores si el
    // intento anterior falló (status "failed" -> se vuelve a recoger), y
    // necesitamos que ESE reintento SÍ sea deduplicado por PayPal si la
    // primera llamada en realidad se procesó pero la respuesta se perdió
    // (timeout de red, etc.) -- una key aleatoria por llamada rompería esa
    // protección contra reembolso duplicado, que es un riesgo mayor que el
    // caso hipotético (hoy no implementado) de dos reembolsos parciales
    // legítimos de idéntico monto sobre la misma captura.
    const idempotencyKey = `refund:${captureId}:${amount !== undefined ? amount.toFixed(2) : "full"}`;

    const res = await fetch(`${getPayPalBaseUrl()}/v2/payments/captures/${captureId}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        // Idempotencia: PayPal soporta PayPal-Request-Id para deduplicar
        // reintentos del MISMO reembolso (ver comentario arriba sobre por
        // qué incluye el monto pero no un UUID).
        "PayPal-Request-Id": idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      name?: string;
      message?: string;
      details?: Array<{ issue?: string; description?: string }>;
    };

    if (!res.ok) {
      const detail =
        data.details?.map((d) => d.issue || d.description).filter(Boolean).join("; ") ||
        data.message ||
        `HTTP ${res.status}`;
      return { success: false, error: `PayPal refund failed: ${detail}` };
    }

    return { success: true, refundId: data.id, status: data.status };
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown PayPal refund error";
    return { success: false, error: message };
  }
}

/**
 * Verifica una transacción de PayPal.
 *
 * @param transactionId ID de la transacción (capture u order).
 * @param expectedAmount Monto esperado en dólares CAD (opcional).
 */
export async function verifyPayPalTransaction(
  transactionId: string,
  expectedAmount?: number
): Promise<PayPalVerificationResult> {
  try {
    const accessToken = await getAccessToken();

    // Intentar primero como capture ID (pago completado).
    let result = await fetchCapture(accessToken, transactionId);

    // Si no existe, intentar como order ID.
    if (!result) {
      result = await fetchOrder(accessToken, transactionId);
    }

    if (!result) {
      return {
        valid: false,
        transactionId,
        error: "Transaction not found in PayPal",
      };
    }

    // Fix (auditoría externa, verificado 2026-07-31): nunca se validaba la
    // moneda de la transacción, solo el monto numérico. Todo el negocio
    // opera en CAD; una transacción en USD (u otra moneda) por un valor
    // numérico similar podía pasar la comparación de monto y aceptarse
    // como si fuera CAD, subvalorando el pago real recibido (1 USD < 1 CAD).
    if (result.currency !== undefined && result.currency !== "CAD") {
      return {
        valid: false,
        transactionId,
        status: result.status,
        amount: result.amount,
        currency: result.currency,
        error: `Currency mismatch: expected CAD, got ${result.currency}`,
      };
    }

    if (expectedAmount !== undefined && result.amount !== undefined) {
      // Permitir diferencia de 1 centavo por redondeo
      if (Math.abs(result.amount - expectedAmount) > 0.01) {
        return {
          valid: false,
          transactionId,
          status: result.status,
          amount: result.amount,
          currency: result.currency,
          error: `Amount mismatch: expected ${expectedAmount} ${result.currency}, got ${result.amount} ${result.currency}`,
        };
      }
    }

    if (!result.valid) {
      return {
        valid: false,
        transactionId,
        status: result.status,
        amount: result.amount,
        currency: result.currency,
        error: `Transaction status is ${result.status}`,
      };
    }

    return result;
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown PayPal error";
    return {
      valid: false,
      transactionId,
      error: message,
    };
  }
}
